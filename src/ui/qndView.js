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
let blocks = false;
try {
    if (localStorage.getItem('quirk-qnd-blocks') === '1') {
        blocks = true;
    }
} catch (_) {
}
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
    /** Building block waiting for a click on the circuit to be placed (see QndView.placeBlock). */
    placing: undefined,
    placeBlock(col, row) {},
    /** Picks up a block found in the circuit (see findBlocks), to be put down with placeBlock. */
    pickUpBlock(found) {},
    /** Keep the current readout outcomes instead of sampling new ones every few hundred ms (edits still resample). */
    pauseSampling: false,
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
    /** Whether recognized building blocks are framed and labelled (and can be grabbed to move them). */
    get blocks() {
        return blocks;
    },
    set blocks(v) {
        blocks = !!v;
        try {
            localStorage.setItem('quirk-qnd-blocks', blocks ? '1' : '0');
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
    },
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
 * Works out the classical record of a circuit: which wires only ever hold readout bits, the record
 * name of every QNDread, and which controlled columns are really classically-controlled corrections.
 * @param {!Array.<!Array.<*>>} cols Circuit JSON columns.
 * @param {!Array.<*>} init Circuit JSON initial states.
 */
/** The gates allowed on a QND record wire: readouts, and controls conditioning on the bit. */
const RECORD_WIRE_GATES = ['QNDread', '•', '◦', 'zpar'];

/**
 * Record wires: start in |0⟩ and hold a QND readout. They're classical; other gates on them are disabled.
 * @param {!Array.<!Array.<*>>} cols
 * @param {!Array.<*>} init
 * @returns {!Set.<!int>}
 */
function recordBitRows(cols, init) {
    const idOf = g => g && typeof g === 'object' ? g.id : g;
    let n = Math.max(0, ...cols.map(c => c.length), init.length);
    let bitRows = new Set();
    for (let q = 0; q < n; q++) {
        if ((!init[q] || init[q] === '0' || init[q] === 0) && cols.some(col => idOf(col[q]) === 'QNDread')) {
            bitRows.add(q);
        }
    }
    return bitRows;
}

function computeRecord(cols, init) {
    const idOf = g => g && typeof g === 'object' ? g.id : g;
    let bitRows = recordBitRows(cols, init);

    let names = recordNames(cols);
    let readName = new Map();
    let cond = new Map();
    let lastRead = new Map();
    let live = [];
    cols.forEach((col, c) => {
        let ctlRows = [];
        let negRows = new Set();
        let parityRows = [];
        let targets = [];
        let blocked = false;
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id === undefined || id === null || id === 1) {
                return;
            }
            if (id === '•') {
                ctlRows.push(q);
            } else if (id === '◦' && bitRows.has(q)) {
                // An anti-control on a bit wire: the condition is that entry being 0.
                ctlRows.push(q);
                negRows.add(q);
            } else if (id === 'zpar' && bitRows.has(q)) {
                // Z-parity controls on bit wires: the correction is conditioned on the XOR of those entries.
                parityRows.push(q);
            } else if (id === 'QNDread' || /par$/.test(id) || id === '◦' || /^reset/.test(id)) {
                blocked = true;  // (A reset can't be a conditioned correction.)
            } else {
                targets.push(q);
            }
        });
        let parity = parityRows.length > 0;
        if (parity && ctlRows.length === 0) {
            ctlRows = parityRows;
        } else if (parity) {
            blocked = true;  // Mixed AND / XOR conditions aren't shown as a single classical gate.
        }
        if (parity && negRows.size > 0) {
            blocked = true;  // A negated XOR entry has no single classical gate either.
        }
        if (!blocked &&
                ctlRows.length &&
                targets.length &&
                ctlRows.every(q => bitRows.has(q) && lastRead.has(q)) &&
                targets.every(q => !bitRows.has(q))) {
            let entry = {keys: ctlRows.map(q => lastRead.get(q)), ctlRows, targets, parity};
            if (negRows.size > 0) {
                entry.negated = ctlRows.map(q => negRows.has(q));
            }
            cond.set(c, entry);
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

    // Adjacent corrections applying the same Paulis, each on one record bit, multiply out: X^a·X^b = X^(a⊕b).
    // They're shown as one gate: the first column's cond gets all the keys (parity), the others go in mergedInto.
    let mergedInto = new Map();
    let paulis = c => cond.get(c).targets.map(q => idOf(cols[c][q])).join(',');
    for (let c = 1; c < cols.length; c++) {
        let head = mergedInto.has(c - 1) ? mergedInto.get(c - 1) : c - 1;
        let a = cond.get(head);
        let b = cond.get(c);
        if (a !== undefined && b !== undefined && b.keys.length === 1 && (a.parity || a.keys.length === 1) &&
                a.keys.indexOf(b.keys[0]) < 0 &&
                String(a.targets) === String(b.targets) &&
                /^[XYZ](,[XYZ])*$/.test(paulis(c)) && paulis(c) === paulis(head)) {
            let merged = {keys: a.keys.concat(b.keys), ctlRows: a.ctlRows.concat(b.ctlRows), targets: a.targets,
                parity: true, merged: (a.merged || []).concat([c])};
            // A negated single entry stays negated in the XOR: Z^(1⊕a)·Z^b = Z^(1⊕a⊕b).
            if (a.negated || b.negated) {
                merged.negated = (a.negated || a.keys.map(() => false)).concat(b.negated || [false]);
            }
            cond.set(head, merged);
            mergedInto.set(c, head);
        }
    }
    return {bitRows, readName, cond, mergedInto, count: readName.size, explicit: names.explicit, live};
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
    if (arg === undefined || arg === null || recOp(arg) === undefined) {
        return undefined;
    }
    let m = String(arg).replace(/[₀-₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch))).match(/\d+/g);
    return m ? m.map(Number) : undefined;
}

/**
 * @param {*} arg e.g. "¬2", "¬0*3" (also with ! or ~).
 * @returns {!Array.<!boolean>} For each entry parseRecArg gives, whether it's negated (the condition is c = 0).
 */
function recNegated(arg) {
    if (arg === undefined || arg === null) {
        return [];
    }
    let m = String(arg).replace(/[₀-₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch))).match(/[!¬~]?\s*\d+/g);
    return m ? m.map(t => /^[!¬~]/.test(t)) : [];
}

/**
 * @param {*} arg A record expression like "6", "6+2" (c₆ xor c₂) or "6*2" (c₆ and c₂).
 * @returns {undefined|!string} 'xor' or 'and' (also for a single entry), undefined if both are mixed.
 */
function recOp(arg) {
    let text = String(arg);
    let xor = /[+^⊕]/.test(text);
    let and = /[*&·]/.test(text);
    return xor && and ? undefined : and ? 'and' : 'xor';
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
            let and = recOp(condArg(g)) === 'and';
            let neg = recNegated(condArg(g));
            let key = ks.map((k, i) => (neg[i] ? '¬' : '') + k).join(',') + (and ? '&' : '^');
            if (!groups.has(key)) {
                groups.set(key, {bits: sources.map(e => e[0]), and, neg, targets: []});
            }
            groups.get(key).targets.push([q, idOf(g)[0]]);
        }

        if (conds.length === 0 || base.some(g => g !== 1 && g !== undefined && g !== null)) {
            out.push(base);
        }
        for (let {bits, and, neg, targets} of groups.values()) {
            // One entry: a plain control. Several: Z-parity controls, so the column applies the XOR c_i⊕c_j⊕...
            let entries = [];
            bits.forEach((b, i) => {
                // AND: plain controls (anti-controls for negated entries). XOR: Z-parity controls (odd parity).
                entries.push([b, bits.length === 1 || and ? (neg[i] ? '◦' : '•') : 'zpar']);
            });
            // XOR with negated entries: ¬a⊕b = 1⊕a⊕b, so an odd number of them adds the Pauli unconditionally.
            if (bits.length > 1 && !and && neg.filter(v => v).length % 2 === 1) {
                let pauliCol = [];
                for (let [q, g] of targets) {
                    while (pauliCol.length <= q) {
                        pauliCol.push(1);
                    }
                    pauliCol[q] = g;
                }
                out.push(pauliCol);
            }
            let newCol = [];
            for (let [q, g] of entries.concat(targets)) {
                while (newCol.length <= q) {
                    newCol.push(1);
                }
                newCol[q] = g;
            }
            out.push(newCol);
        }
    });
    return Object.assign({}, circuitJson, {cols: out});
}

// Displays don't change the state.
const DISPLAY = /^(Bloch|Density|Chance|Amps|Sample|…)/;

/**
 * What a circuit uses, for comparing its gate and QND forms.
 * @param {!{cols: (undefined|!Array), init: (undefined|!Array)}} circuitJson
 * @returns {!{qubits: !int, bits: !int, readouts: !int, maxWeight: !int, twoQubit: !int, swaps: !int,
 *     corrections: !int, resets: !int, depth: !int}} twoQubit: gates controlled by a qubit (CX, CZ, …), one per
 *     target. corrections: gates conditioned on record bits, one per target. depth: non-empty columns.
 */
function circuitResources(circuitJson) {
    let circuit = resolveClassical(circuitJson) || circuitJson;
    let cols = circuit.cols || [];
    let init = circuit.init || [];
    let bits = recordBitRows(cols, init);
    let used = new Set();
    init.forEach((v, q) => {
        if (v && v !== '0' && !bits.has(q)) {
            used.add(q);
        }
    });
    let r = {qubits: 0, bits: bits.size, readouts: 0, maxWeight: 0, twoQubit: 0, swaps: 0, corrections: 0, resets: 0,
        depth: 0};
    for (let col of cols) {
        let cells = [];
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id !== 1 && id !== undefined && id !== null && !DISPLAY.test(id)) {
                cells.push({q, id});
            }
        });
        if (cells.length === 0) {
            continue;
        }
        r.depth++;
        let onQubits = cells.filter(e => !bits.has(e.q));
        for (let e of onQubits) {
            used.add(e.q);
        }
        let weight = onQubits.filter(e => /^[xyz]par$/.test(e.id)).length;
        let reads = cells.filter(e => e.id === 'QNDread' || e.id === 'Measure').length;
        r.readouts += reads;
        if (reads > 0) {
            r.maxWeight = Math.max(r.maxWeight, weight, 1);
            continue;
        }
        let targets = onQubits.filter(e => !/par$/.test(e.id) && e.id !== '•' && e.id !== '◦');
        r.resets += targets.filter(e => /^reset/.test(e.id)).length;
        if (cells.some(e => bits.has(e.q))) {
            r.corrections += targets.length;
        } else if (onQubits.some(e => e.id === '•' || e.id === '◦')) {
            r.twoQubit += targets.length;
        }
        r.swaps += targets.filter(e => e.id === 'Swap').length / 2;
    }
    r.qubits = used.size;
    return r;
}

export {QndView, qndCheckInColumn, computeRecord, recordBitRows, RECORD_WIRE_GATES, parseRecArg, recNegated, recOp,
    resolveClassical, COND_RE, DISPLAY, circuitResources}
