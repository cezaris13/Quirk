/**
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared view state for the QND fork (compact parity checks, input tabs, classical record) and the
 * analysis helpers that turn QNDread outcomes into a classical record c₀, c₁, ...
 */

let compact = true;
let tabs = true;
let record = false;
try {
    if (localStorage.getItem('quirk-qnd-record') === '1') {
        record = true;
    }
} catch (_) {
}
try {
    if (localStorage.getItem('quirk-qnd-tabs') === '0') {
        tabs = false;
    }
} catch (_) {
}
try {
    if (localStorage.getItem('quirk-qnd-compact') === '0') {
        compact = false;
    }
} catch (_) {
}

const QndView = {
    /** Columns whose compact/expanded state differs from the global default. */
    toggled: new Set(),
    requestRedraw() {},
    get compact() {
        return compact;
    },
    layoutKey() {
        return (compact ? 'c' : 'e') + [...QndView.toggled].sort((a, b) => a - b).join(',');
    },
    set compact(v) {
        if (!!v !== compact) {
            QndView.onBeforeViewChange();
        }
        compact = !!v;
        QndView.toggled.clear();
        try {
            localStorage.setItem('quirk-qnd-compact', compact ? '1' : '0');
        } catch (_) {
        }
        QndView.requestRedraw();
    },
    get tabs() {
        return tabs;
    },
    set tabs(v) {
        if (!!v !== tabs) {
            QndView.onBeforeViewChange();
        }
        tabs = !!v;
        try {
            localStorage.setItem('quirk-qnd-tabs', tabs ? '1' : '0');
        } catch (_) {
        }
        QndView.requestRedraw();
    },
    get record() {
        return record;
    },
    set record(v) {
        if (!!v !== record) {
            QndView.onBeforeViewChange();
        }
        record = !!v;
        try {
            localStorage.setItem('quirk-qnd-record', record ? '1' : '0');
        } catch (_) {
        }
        QndView.requestRedraw();
        QndView.onRecordChange();
    },
    onRecordChange() {},
    onBeforeViewChange() {},
    /** Current compact/expand animation, as {t0, dur, ...}. */
    anim: undefined,
    dragging: false,
    frozen: undefined,
    /** Eased (cubic in-out) progress of the current animation, in [0, 1]. */
    animProgress() {
        let anim = QndView.anim;
        if (anim === undefined) {
            return 1;
        }
        let t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    isCompact(col) {
        return compact !== QndView.toggled.has(col);
    },
    toggle(col) {
        QndView.onBeforeViewChange();
        if (QndView.toggled.has(col)) {
            QndView.toggled.delete(col);
        } else {
            QndView.toggled.add(col);
        }
        QndView.requestRedraw();
    }
};

/**
 * Finds a QND parity check (parity controls + a QNDread target) in a circuit column.
 * @param {!GateColumn} col
 * @returns {undefined|!{rows: !Array.<!int>, paulis: !Array.<!string>, readRow: !int}}
 */
function qndCheckInColumn(col) {
    let rows = [];
    let paulis = [];
    let readRow = undefined;
    col.gates.forEach((g, row) => {
        if (g === undefined) {
            return;
        }
        if (g.serializedId === 'QNDread') {
            readRow = row;
        } else if (g.serializedId === 'zpar' || g.serializedId === 'xpar' || g.serializedId === 'ypar') {
            rows.push(row);
            paulis.push(g.serializedId[0].toUpperCase());
        }
    });
    if (readRow === undefined || rows.length === 0) {
        return undefined;
    }
    return {rows, paulis, readRow};
}

/**
 * @param {!int} k
 * @returns {!string} e.g. "c₁₂".
 */
function recName(k) {
    return 'c' + String(k).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
}

/**
 * Works out the classical record of a circuit: which wires only ever hold readout bits, the record
 * name of every QNDread, and which controlled columns are really classically-controlled corrections.
 * @param {!Array.<!Array.<*>>} cols Circuit JSON columns.
 * @param {!Array.<*>} init Circuit JSON initial states.
 */
function computeRecord(cols, init) {
    const idOf = g => g && typeof g === 'object' ? g.id : g;
    let n = Math.max(0, ...cols.map(c => c.length), init.length);

    // Wires starting in |0⟩ that are only written by QNDread and only used as controls.
    let bitRows = new Set();
    for (let q = 0; q < n; q++) {
        if (!init[q] || init[q] === '0' || init[q] === 0) {
            let reads = 0;
            let other = false;
            for (let col of cols) {
                let id = idOf(col[q]);
                if (id === undefined || id === null || id === 1) {
                    continue;
                }
                if (id === 'QNDread') {
                    reads++;
                } else if (id !== '•') {
                    other = true;
                }
            }
            if (reads > 0 && !other) {
                bitRows.add(q);
            }
        }
    }

    let names = recordNames(cols);
    let readName = new Map();
    let cond = new Map();
    let lastRead = new Map();
    let live = [];
    cols.forEach((col, c) => {
        let ctlRows = [];
        let targets = [];
        let blocked = false;
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id === undefined || id === null || id === 1) {
                return;
            }
            if (id === '•') {
                ctlRows.push(q);
            } else if (id === 'QNDread' || /par$/.test(id) || id === '◦') {
                blocked = true;
            } else {
                targets.push(q);
            }
        });
        if (!blocked &&
                ctlRows.length &&
                targets.length &&
                ctlRows.every(q => bitRows.has(q) && lastRead.has(q)) &&
                targets.every(q => !bitRows.has(q))) {
            cond.set(c, {keys: ctlRows.map(q => lastRead.get(q)), ctlRows, targets});
        }
        col.forEach((g, q) => {
            if (idOf(g) === 'QNDread') {
                let k = names.get(`${c}:${q}`);
                readName.set(`${c}:${q}`, k);
                lastRead.set(q, k);
            }
        });
        live.push(new Set(lastRead.values()));
    });
    return {bitRows, readName, cond, count: readName.size, explicit: names.explicit, live};
}

/**
 * Assigns record indices to QNDread gates, in circuit order unless a read names its bit explicitly.
 * @param {!Array.<!Array.<*>>} cols
 * @returns {!Map.<!string, !int>} Keyed by "col:row", with an extra `explicit` Set property.
 */
function recordNames(cols) {
    const idOf = g => g && typeof g === 'object' ? g.id : g;
    let names = new Map();
    let explicit = new Set();
    let counter = 0;
    cols.forEach((col, c) => col.forEach((g, q) => {
        if (idOf(g) !== 'QNDread') {
            return;
        }
        let ks = g && typeof g === 'object' ? parseRecArg(g.arg) : undefined;
        if (ks !== undefined && ks.length) {
            names.set(`${c}:${q}`, ks[0]);
            explicit.add(`${c}:${q}`);
        } else {
            names.set(`${c}:${q}`, counter);
        }
        counter++;
    }));
    names.explicit = explicit;
    return names;
}

/** Classically-controlled Pauli gates, e.g. X^c with arg "c₀⊕c₂". */
const COND_RE = /^[XYZ]\^c$/;
const idOf = g => g && typeof g === 'object' ? g.id : g;
const isCond = g => typeof g === 'string' ? COND_RE.test(g) : !!(g && typeof g === 'object' && COND_RE.test(g.id));
const condArg = g => typeof g === 'string' ? undefined : g.arg;

/**
 * @param {*} arg e.g. "c₀⊕c₃", "0,3".
 * @returns {undefined|!Array.<!int>}
 */
function parseRecArg(arg) {
    if (arg === undefined || arg === null) {
        return undefined;
    }
    let m = String(arg).replace(/[₀-₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch))).match(/\d+/g);
    return m ? m.map(Number) : undefined;
}

/**
 * Rewrites classically-controlled gates (X^c etc) into ordinary controlled gates from the wires holding
 * the referenced record bits, so the circuit can be simulated by stock Quirk.
 * @param {!{cols: (undefined|!Array)}} circuitJson
 * @returns {undefined|!Object} Undefined when there's nothing to rewrite.
 */
function resolveClassical(circuitJson) {
    let cols = circuitJson.cols || [];
    if (!cols.some(col => col.some(isCond))) {
        return undefined;
    }
    let out = [];
    let lastRead = new Map();
    let names = recordNames(cols);
    cols.forEach((col, c) => {
        let conds = [];
        let base = col.map((g, q) => {
            if (isCond(g)) {
                conds.push([q, g]);
                return 1;
            }
            return g;
        });
        col.forEach((g, q) => {
            if (idOf(g) === 'QNDread') {
                lastRead.delete(q);
                lastRead.set(q, names.get(`${c}:${q}`));
            }
        });

        let groups = new Map();
        for (let [q, g] of conds) {
            let ks = parseRecArg(condArg(g));
            if (ks === undefined) {
                let vals = [...lastRead.values()];
                ks = vals.length ? [vals[vals.length - 1]] : undefined;
            }
            if (ks && ks.length === 0) {
                ks = undefined;
            }
            let sources = ks === undefined
                ? undefined
                : ks.map(k => [...lastRead.entries()].reverse().find(e => e[1] === k));
            if (sources === undefined || sources.some(e => e === undefined || e[0] === q)) {
                base[q] = g;
                continue;
            }
            let key = ks.join(',');
            if (!groups.has(key)) {
                groups.set(key, {bits: sources.map(e => e[0]), targets: []});
            }
            groups.get(key).targets.push([q, idOf(g)[0]]);
        }

        if (conds.length === 0 || base.some(g => g !== 1 && g !== undefined && g !== null)) {
            out.push(base);
        }
        for (let {bits, targets} of groups.values()) {
            for (let b of bits) {
                let newCol = [];
                for (let [q, g] of [[b, '•'], ...targets]) {
                    while (newCol.length <= q) {
                        newCol.push(1);
                    }
                    newCol[q] = g;
                }
                out.push(newCol);
            }
        }
    });
    return Object.assign({}, circuitJson, {cols: out});
}

export {QndView, qndCheckInColumn, computeRecord, recordNames, recName, parseRecArg, resolveClassical, COND_RE}
