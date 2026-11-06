/**
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

import {Config} from "../Config.js"
import {QND_EXAMPLES} from "./qndExamples.js"
import {computeRecord, recordBitRows, parseRecArg, COND_RE, RECORD_WIRE_GATES} from "./qndView.js"

/**
 * Building blocks of bias-preserving circuits: each has a gate form (ideal Pauli measurement plus relocation
 * swaps, what you place) and the QND form it compiles to (QND Z-parity readouts, X readouts and Pauli-frame
 * corrections, as in arXiv:2605.24262). Compiling finds gate forms anywhere in a circuit, on any wires.
 * Checked numerically: each QND form leaves the same data state as its gate form, for every readout outcome.
 */

const example = id => {
    let ex = QND_EXAMPLES.find(e => e.id === id);
    return {gate: ex.gate, qnd: ex.qnd};
};

/**
 * The QND forms end by re-preparing each measured wire in |+⟩: that's the state the gate form leaves there
 * (the swapped-out ancilla), so both forms are equal on every wire but the readout bits, and chain cleanly.
 */
const plusReset = block => Object.assign({}, block, {qnd: Object.assign({}, block.qnd, {
    cols: block.qnd.cols.map(col => col.map(g => g === 'reset0' ? 'reset+' : g))
})});

/** Weight-4 X check from three overlapping M_Z⊗4 (App. D, Fig. 20): data on rows 1,3,5,7, |+⟩ above each. */
const X4_CHECK = {
    gate: {
        cols: [
            [1, "xpar", 1, "xpar", 1, "xpar", 1, "xpar", "QNDread"],
            ["Swap", "Swap"],
            [1, 1, "Swap", "Swap"],
            [1, 1, 1, 1, "Swap", "Swap"],
            [1, 1, 1, 1, 1, 1, "Swap", "Swap"]
        ],
        init: ["+", 0, "+", 0, "+", 0, "+", 0]
    },
    qnd: {
        cols: [
            ["zpar", "zpar", "zpar", "zpar", 1, 1, 1, 1, "QNDread"],
            [1, 1, "zpar", "zpar", "zpar", "zpar", 1, 1, 1, "QNDread"],
            [1, 1, 1, 1, "zpar", "zpar", "zpar", "zpar", 1, 1, "QNDread"],
            [1, "xpar", 1, 1, 1, 1, 1, 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, "xpar", 1, 1, 1, 1, 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, 1, 1, "xpar", 1, 1, 1, 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, 1, 1, 1, 1, "xpar", 1, 1, 1, 1, 1, 1, "QNDread"],
            ["Z", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, "Z", 1, 1, 1, 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, "Z", 1, 1, 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, 1, 1, "Z", 1, 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, "X", 1, 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, "X", 1, 1, 1, "•"],
            [1, 1, 1, 1, "X", 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, 1, 1, "X", 1, "•"],
            [1, 1, 1, 1, 1, 1, "X", 1, 1, "•"],
            [1, 1, 1, 1, 1, 1, "X", 1, 1, 1, "•"],
            [1, "reset0", 1, "reset0", 1, "reset0", 1, "reset0"]
        ],
        init: ["+", 0, "+", 0, "+", 0, "+", 0]
    }
};

/** Weight-3 X check, the X⊗4 construction with one pair fewer: data on rows 1,3,5, |+⟩ above each. */
const X3_CHECK = {
    gate: {
        cols: [
            [1, "xpar", 1, "xpar", 1, "xpar", "QNDread"],
            ["Swap", "Swap"],
            [1, 1, "Swap", "Swap"],
            [1, 1, 1, 1, "Swap", "Swap"]
        ],
        init: ["+", 0, "+", 0, "+", 0]
    },
    qnd: {
        cols: [
            ["zpar", "zpar", "zpar", "zpar", 1, 1, "QNDread"],
            [1, 1, "zpar", "zpar", "zpar", "zpar", 1, "QNDread"],
            [1, "xpar", 1, 1, 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, "xpar", 1, 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, 1, 1, "xpar", 1, 1, 1, 1, "QNDread"],
            ["Z", 1, 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, "Z", 1, 1, 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, "Z", 1, 1, 1, 1, 1, "•"],
            [1, 1, "X", 1, 1, 1, "•"],
            [1, 1, 1, 1, "X", 1, "•"],
            [1, 1, 1, 1, "X", 1, 1, "•"],
            [1, "reset0", 1, "reset0", 1, "reset0"]
        ],
        init: ["+", 0, "+", 0, "+", 0]
    }
};

/** Weight-3 boundary checks of the XZZX code: Fig. 2(c) with one Z dropped (its CZ and correction go too). */
const ZXX_CHECK = {
    gate: {
        cols: [
            ["zpar", 1, "xpar", "xpar", 1, "QNDread"],
            [1, "Swap", "Swap"],
            [1, 1, 1, "Swap", "Swap"]
        ],
        init: [0, "+", 0, 0, "+"]
    },
    qnd: {
        cols: [
            ["•", 1, "Z"],
            [1, "zpar", "zpar", "zpar", "zpar", "QNDread"],
            [1, 1, "xpar", 1, 1, 1, "QNDread"],
            [1, 1, 1, "xpar", 1, 1, 1, "QNDread"],
            ["•", "Z"],
            [1, "Z", 1, 1, 1, 1, "•"],
            [1, 1, 1, 1, "X", "•"],
            [1, 1, 1, 1, "Z", 1, 1, "•"],
            [1, 1, "reset+", "reset+"]
        ],
        init: [0, "+", 0, 0, "+"]
    }
};
const XXZ_CHECK = {
    gate: {
        cols: [
            [1, "xpar", "xpar", 1, "zpar", "QNDread"],
            ["Swap", "Swap"],
            [1, 1, "Swap", "Swap"]
        ],
        init: ["+", 0, 0, "+"]
    },
    qnd: {
        cols: [
            [1, 1, "Z", 1, "•"],
            ["zpar", "zpar", "zpar", "zpar", 1, "QNDread"],
            [1, "xpar", 1, 1, 1, 1, "QNDread"],
            [1, 1, "xpar", 1, 1, 1, 1, "QNDread"],
            [1, 1, 1, "Z", "•"],
            ["Z", 1, 1, 1, 1, 1, "•"],
            [1, 1, 1, "X", 1, "•"],
            [1, 1, 1, 1, "Z", "•"],
            [1, 1, 1, "Z", 1, 1, 1, "•"],
            [1, "reset+", "reset+"]
        ],
        init: ["+", 0, 0, "+"]
    }
};

/** Largest first, so a bigger block isn't split into smaller ones while compiling. */
const QND_BLOCKS = [
    Object.assign({name: 'X⊗4 check (App. D)'}, X4_CHECK),
    Object.assign({name: 'X⊗3 check (App. D)'}, X3_CHECK),
    // The paper's own QND form of an X⊗3 check (three overlapping Z⊗4), so it's recognized too. Not in the picker:
    // its gate form is the X⊗3 check above, which is found first.
    Object.assign({name: 'X⊗3 check (App. D, Fig. 20)', hidden: true}, example('x4-3-1')),
    Object.assign({name: 'ZXXZ check (Fig. 2c)'}, example('zxxz-')),
    Object.assign({name: 'ZXX boundary check'}, ZXX_CHECK),
    Object.assign({name: 'XXZ boundary check'}, XXZ_CHECK),
    Object.assign({name: 'X⊗2 check (Fig. 2b)'}, example('xx-')),
    Object.assign({name: 'BP-CNOT (Fig. 2a)'}, example('cx-'))
].map(plusReset);

const isEmpty = g => g === 1 || g === undefined || g === null;
const rowCount = circuit => Math.max(0, (circuit.init || []).length, ...circuit.cols.map(col => col.length));
const entriesOf = col => col.map((g, row) => [row, g]).filter(([, g]) => !isEmpty(g));

/**
 * @returns {!Array.<!Set.<!int>>} For each column, the wires holding a fresh |+⟩ just before it: started in |+⟩
 *     or were reset to |+⟩ (possibly swapped there since), with nothing else touching them.
 */
function freshPlusWires(cols, init) {
    let fresh = new Set();
    init.forEach((v, w) => v === '+' && fresh.add(w));
    let result = [];
    for (let col of cols) {
        result.push(new Set(fresh));
        let entries = entriesOf(col);
        let swaps = entries.filter(([, g]) => g === 'Swap').map(([w]) => w);
        let swapped = swaps.length === 2 && entries.length === 2;
        if (swapped) {
            let [a, b] = swaps;
            let fa = fresh.has(a), fb = fresh.has(b);
            fresh.delete(a);
            fresh.delete(b);
            fa && fresh.add(b);
            fb && fresh.add(a);
            continue;
        }
        for (let [w, g] of entries) {
            if (g === 'reset+') {
                fresh.add(w);
            } else {
                fresh.delete(w);
            }
        }
    }
    result.push(new Set(fresh));
    return result;
}

const PAULI_TARGET = /^[XYZ]$/;
const isControl = g => g === '•' || g === '◦';

/**
 * Whether two template columns can be swapped without changing what they do: they touch different wires apart from
 * shared controls, or both only apply (controlled) Paulis, which commute up to a phase.
 */
function columnsCommute(a, b) {
    let ea = entriesOf(a);
    let eb = entriesOf(b);
    let paulisOnly = e => e.every(([, g]) => isControl(g) || PAULI_TARGET.test(g));
    if (paulisOnly(ea) && paulisOnly(eb)) {
        return true;
    }
    let rowsB = new Map(eb);
    return ea.every(([r, g]) => !rowsB.has(r) || (isControl(g) && isControl(rowsB.get(r))));
}

/**
 * @returns {undefined|!Map.<!int, !int>} Template row → circuit row, if the template's columns are at column k;
 *     its `len` is how many circuit columns the block takes. Like the papers' circuits, the match allows:
 *     - columns without a readout in another order, where they commute;
 *     - the block's final resets later on (alone or with other resets), if nothing touches those wires in between.
 */
function matchAt(cols, fresh, k, template) {
    // (A helper, not an inline arrow: traceur overflows its stack on a destructuring arrow in a while condition.)
    let isResetColumn = col => entriesOf(col).every(e => e[1] === 'reset0' || e[1] === 'reset+');
    let n = template.cols.length;
    while (n > 0 && isResetColumn(template.cols[n - 1])) {
        n--;
    }
    let resets = template.cols.slice(n);
    if (k + n > cols.length) {
        return undefined;
    }
    let map = new Map();
    let used = new Set();
    let placed = new Set();
    let hasRead = col => col.some(g => g === 'QNDread');
    // A template |+⟩ wire must hold a fresh |+⟩ in the circuit when the block starts.
    let fits = (tr, cr) => (template.init[tr] || 0) !== '+' || fresh[k].has(cr);
    let matchColumn = j => {
        if (j === n) {
            return true;
        }
        let have = entriesOf(cols[k + j]);
        if (have.some(([, g]) => typeof g !== 'string')) {
            return false;
        }
        for (let t = 0; t < n; t++) {
            if (tryColumn(t, j, have)) {
                return true;
            }
        }
        return false;
    };
    // Template column t at circuit column k + j.
    let tryColumn = (t, j, have) => {
        let tcol = template.cols[t];
        if (placed.has(t) || (t !== j && (hasRead(tcol) || hasRead(template.cols[j])))) {
            return false;
        }
        // Template columns before t that aren't placed yet now come after it: t must commute with them.
        for (let e = 0; e < t; e++) {
            if (!placed.has(e) && !columnsCommute(template.cols[e], tcol)) {
                return false;
            }
        }
        placed.add(t);
        if (matchEntries(entriesOf(tcol), have, () => matchColumn(j + 1))) {
            return true;
        }
        placed.delete(t);
        return false;
    };
    let matchEntries = (want, have, rest) => {
        if (want.length !== have.length) {
            return false;
        }
        let matchEntry = i => {
            if (i === want.length) {
                return rest();
            }
            let [tr, tg] = want[i];
            if (map.has(tr)) {
                let cr = map.get(tr);
                return have.some(([r, g]) => r === cr && g === tg) && matchEntry(i + 1);
            }
            for (let [cr, g] of have) {
                if (g !== tg || used.has(cr) || !fits(tr, cr)) {
                    continue;
                }
                map.set(tr, cr);
                used.add(cr);
                if (matchEntry(i + 1)) {
                    return true;
                }
                map.delete(tr);
                used.delete(cr);
            }
            return false;
        };
        return matchEntry(0);
    };
    if (!matchColumn(0)) {
        return undefined;
    }
    // The final resets: right after the block, else later.
    let inPlace = resets.every((tcol, i) => k + n + i < cols.length &&
        matchEntries(entriesOf(tcol), entriesOf(cols[k + n + i]), () => true));
    if (!inPlace) {
        for (let [tr, g] of [].concat(...resets.map(entriesOf))) {
            let cr = map.get(tr);
            let c = k + n;
            while (c < cols.length && isEmpty(cols[c][cr])) {
                c++;
            }
            if (cr === undefined || c === cols.length || cols[c][cr] !== g) {
                return undefined;
            }
        }
    }
    map.len = inPlace ? n + resets.length : n;
    return map;
}

/**
 * Replaces every block found in one form ('gate' or 'qnd') by its other form. Rows only the target form has
 * (the QND readout bits) go on new wires below.
 * @returns {undefined|!{cols: !Array, init: !Array}} Undefined when no block was found.
 */
function rewrite(circuit, from, to, limit) {
    let cols = circuit.cols;
    let init = circuit.init || [];
    let fresh = freshPlusWires(cols, init);
    let wires = rowCount(circuit);
    let out = [];
    let count = 0;
    for (let k = 0; k < cols.length;) {
        let hit = undefined;
        for (let block of QND_BLOCKS) {
            let map = matchAt(cols, fresh, k, block[from]);
            let extra = Math.max(0, rowCount(block[to]) - rowCount(block[from]));
            if (map !== undefined && wires + extra <= limit) {
                hit = {block, map};
                break;
            }
        }
        if (hit === undefined) {
            out.push(cols[k]);
            k++;
            continue;
        }
        let {block, map} = hit;
        for (let r = rowCount(block[from]); r < rowCount(block[to]); r++) {
            map.set(r, wires++);
        }
        for (let templateCol of block[to].cols) {
            let col = [];
            for (let [r, g] of entriesOf(templateCol)) {
                let cr = map.get(r);
                while (col.length <= cr) {
                    col.push(1);
                }
                col[cr] = g;
            }
            out.push(col);
        }
        k += map.len;
        count++;
    }
    return count > 0 ? {cols: out, init: [...init]} : undefined;
}

const idOf = g => g && typeof g === 'object' ? g.id : g;

/**
 * Each QNDread write on a record-bit wire, with the last column still using its value (a control on that
 * wire, or an X^c gate naming its entry).
 * @returns {undefined|!{bitRows: !Set.<!int>, writes: !Array, at: !Map}} `at` maps "col:row" of every gate on a
 *     bit wire to the write it belongs to. Undefined when the record can't be moved safely (a bit wire read
 *     before it's written, or two reads in one column, whose entry numbers depend on their row order).
 */
function bitWrites(circuit) {
    let cols = circuit.cols;
    let rec = computeRecord(cols, circuit.init || []);
    let writes = [];
    let current = new Map();
    let byKey = new Map();
    let at = new Map();
    let last = undefined;
    for (let c = 0; c < cols.length; c++) {
        let col = cols[c];
        for (let q = 0; q < col.length; q++) {
            let id = idOf(col[q]);
            if (rec.bitRows.has(q) && (id === '•' || id === '◦' || id === 'zpar')) {
                let w = current.get(q);
                if (w === undefined) {
                    return undefined;
                }
                w.end = c;
                at.set(c + ':' + q, w);
            }
        }
        for (let q = 0; q < col.length; q++) {
            // A gate not allowed on a record wire (it's disabled there): leave the wires alone.
            if (rec.bitRows.has(q) && !isEmpty(col[q]) && RECORD_WIRE_GATES.indexOf(idOf(col[q])) === -1) {
                return undefined;
            }
        }
        let reads = 0;
        for (let q = 0; q < col.length; q++) {
            if (rec.bitRows.has(q) && idOf(col[q]) === 'QNDread') {
                let w = {row: q, start: c, end: c};
                writes.push(w);
                current.set(q, w);
                byKey.set(rec.readName.get(c + ':' + q), w);
                at.set(c + ':' + q, w);
                last = w;
                reads++;
            }
        }
        if (reads > 1) {
            return undefined;
        }
        for (let g of col) {
            if (typeof idOf(g) === 'string' && COND_RE.test(idOf(g))) {
                let ks = parseRecArg(typeof g === 'object' ? g.arg : undefined);
                let used = ks === undefined ? (last === undefined ? [] : [last]) : ks.map(k => byKey.get(k));
                for (let w of used) {
                    if (w !== undefined) {
                        w.end = Math.max(w.end, c);
                    }
                }
            }
        }
    }
    return {bitRows: rec.bitRows, writes, at};
}

/** Moves every gate on a bit wire to its write's `slot` row. Undefined if two gates would share a cell. */
function moveBits(circuit, info) {
    let cols = [];
    for (let c = 0; c < circuit.cols.length; c++) {
        let out = [];
        let col = circuit.cols[c];
        for (let q = 0; q < col.length; q++) {
            if (isEmpty(col[q])) {
                continue;
            }
            let w = info.at.get(c + ':' + q);
            let r = w === undefined ? q : w.slot;
            while (out.length <= r) {
                out.push(1);
            }
            if (!isEmpty(out[r])) {
                return undefined;
            }
            out[r] = col[q];
        }
        cols.push(out);
    }
    return {cols, init: [...(circuit.init || [])]};
}

/**
 * Reuses record-bit wires: a QNDread goes on the topmost bit wire whose previous value is no longer used, and
 * bit wires left empty are removed. The record entries (c₀, c₁, ...) and what the circuit does stay the same.
 */
function packBitWires(circuit) {
    let info = bitWrites(circuit);
    if (info === undefined || info.writes.length === 0) {
        return circuit;
    }
    // Slots: the bit wires, plus empty wires below every qubit (e.g. left over from a decompiled block).
    let init = circuit.init || [];
    let lastQubit = -1;
    for (let r = 0; r < rowCount(circuit); r++) {
        if (!info.bitRows.has(r) && ((init[r] || 0) !== 0 || circuit.cols.some(col => !isEmpty(col[r])))) {
            lastQubit = r;
        }
    }
    let slots = [];
    for (let r = 0; r < rowCount(circuit); r++) {
        if (info.bitRows.has(r) || r > lastQubit) {
            slots.push(r);
        }
    }
    let freeAfter = slots.map(() => -1);
    for (let w of info.writes) {
        let i = freeAfter.findIndex(f => f < w.start);
        if (i === -1) {
            return circuit;
        }
        w.slot = slots[i];
        freeAfter[i] = w.end;
    }
    let out = moveBits(circuit, info);
    if (out === undefined) {
        return circuit;
    }
    let empty = slots.filter(r => out.cols.every(col => isEmpty(col[r]))).reverse();
    for (let r of empty) {
        for (let col of out.cols) {
            col.splice(r, 1);
        }
        out.init.splice(r, 1);
    }
    return out;
}

/** The inverse of packBitWires: every QNDread after the first on a bit wire moves to its own new wire below. */
function unpackBitWires(circuit) {
    let info = bitWrites(circuit);
    if (info === undefined) {
        return circuit;
    }
    let next = rowCount(circuit);
    let seen = new Set();
    for (let w of info.writes) {
        w.slot = seen.has(w.row) ? next++ : w.row;
        seen.add(w.row);
    }
    return moveBits(circuit, info) || circuit;
}

/**
 * Compiles every building block in gate form (CX + swap, ...) into its bias-preserving QND form, reusing
 * readout bit wires. If even packed it needs more than Quirk's wires, compiles only the blocks that fit.
 */
function compileToQnd(circuit) {
    let out = rewrite(circuit, 'gate', 'qnd', Infinity);
    if (out !== undefined && rowCount(packBitWires(out)) > Config.MAX_ROW_COUNT) {
        out = rewrite(circuit, 'gate', 'qnd', Config.MAX_ROW_COUNT);
    }
    return out && packBitWires(out);
}

/** Turns every building block in QND form back into its gate form (bit wires may be packed or not). */
function decompileToGate(circuit) {
    let out = rewrite(unpackBitWires(circuit), 'qnd', 'gate', Infinity);
    return out && packBitWires(out);
}

/**
 * Finds every building block in the circuit, in either form, without overlaps (left to right, largest first).
 * @returns {!Array.<!{block: !Object, form: !string, col: !int, len: !int, rows: !Array.<!int>}>} `rows`: the
 *     circuit wires the block's qubits are on (not its readout bits); `plusRows` its |+⟩ ancillas.
 */
function findBlocks(circuit) {
    let cols = circuit.cols;
    let fresh = freshPlusWires(cols, circuit.init || []);
    let found = [];
    for (let k = 0; k < cols.length;) {
        let hit = undefined;
        for (let block of QND_BLOCKS) {
            for (let form of ['gate', 'qnd']) {
                let map = hit === undefined ? matchAt(cols, fresh, k, block[form]) : undefined;
                if (map !== undefined) {
                    let readRows = new Set();
                    for (let col of block[form].cols) {
                        col.forEach((g, r) => g === 'QNDread' && readRows.add(r));
                    }
                    let rows = [...map.entries()].filter(e => !readRows.has(e[0])).map(e => e[1]);
                    let plusRows = [...map.entries()].filter(e => (block[form].init[e[0]] || 0) === '+').
                        map(e => e[1]);
                    hit = {block, form, col: k, len: map.len, rows: rows.sort((a, b) => a - b),
                        plusRows};
                }
            }
        }
        if (hit === undefined) {
            k++;
        } else {
            found.push(hit);
            k += hit.len;
        }
    }
    return found;
}

/** The circuit without a found block's columns (its wires and their initial states stay). */
function removeBlock(circuit, found) {
    let cols = circuit.cols.filter((_, c) => c < found.col || c >= found.col + found.len);
    return {cols, init: [...(circuit.init || [])]};
}

/**
 * Moves a found block as one piece: its columns go before column `col` (counted in the circuit as it is), and its
 * qubit wires shift so its first one lands on `row`, keeping their spacing. Readout bits stay on their record
 * wires. An ancilla landing on an otherwise unused wire gets a fresh |+⟩ there (and an ancilla wire it leaves
 * unused goes back to |0⟩), so the block stays a block.
 * An ancilla landing on a wire that's in use only before the block gets a |+⟩ reset just before it.
 * @returns {!{circuit: (undefined|!Object), error: (undefined|!string), recognized: !boolean,
 *     reset: (undefined|!Array.<!int>), busy: (undefined|!Array.<!int>)}} `recognized`: whether it is still that
 *     block where it landed. `reset`: wires given a |+⟩ reset for it. `busy`: ancilla wires that aren't a fresh |+⟩
 *     there and are used after the block, so they couldn't be reset.
 */
function moveBlock(circuit, found, col, row) {
    let cols = circuit.cols;
    let init = [...(circuit.init || [])];
    let bits = recordBitRows(cols, init);
    let dRow = row - found.rows[0];
    let moved = [];
    for (let c = found.col; c < found.col + found.len; c++) {
        let out = [];
        for (let [r, g] of entriesOf(cols[c])) {
            let nr = bits.has(r) ? r : r + dRow;
            if (nr < 0 || nr >= Config.MAX_ROW_COUNT) {
                return {error: `${found.block.name} doesn't fit there: it would need wire ${nr}.`, recognized: false};
            }
            if (!bits.has(r) && bits.has(nr)) {
                return {error: `${found.block.name} can't go there: wire ${nr} is a classical record wire.`,
                    recognized: false};
            }
            while (out.length <= nr) {
                out.push(1);
            }
            out[nr] = g;
        }
        moved.push(out);
    }
    let others = cols.filter((_, c) => c < found.col || c >= found.col + found.len);
    let unused = w => others.every(c => isEmpty(c[w]));
    let newPlus = new Set(found.plusRows.map(a => a + dRow));
    for (let a of found.plusRows) {
        let na = a + dRow;
        if (na !== a && unused(na) && (init[na] || 0) === 0) {
            while (init.length <= na) {
                init.push(0);
            }
            init[na] = '+';
        }
        if (!newPlus.has(a) && unused(a)) {
            init[a] = 0;
        }
    }
    let at = col <= found.col ? col : col >= found.col + found.len ? col - found.len : found.col;
    at = Math.min(at, others.length);
    // An ancilla landing on a wire that's done (used before the block, not after) is re-prepared in |+⟩ there.
    let fresh = freshPlusWires(others.slice(0, at), init);
    let stale = [...newPlus].filter(w => !fresh[at].has(w));
    let usedAfter = w => others.slice(at).some(c => !isEmpty(c[w]));
    let resettable = stale.filter(w => !usedAfter(w));
    let reset = [];
    for (let w of resettable) {
        while (reset.length <= w) {
            reset.push(1);
        }
        reset[w] = 'reset+';
    }
    let blockAt = resettable.length > 0 ? at + 1 : at;
    let newCols = others.slice(0, at).concat(resettable.length > 0 ? [reset] : [], moved, others.slice(at));
    let result = {cols: newCols, init};
    let recognized = findBlocks(result).some(f => f.col === blockAt && f.block === found.block);
    let busy = stale.filter(usedAfter);
    return {circuit: result, recognized, reset: resettable, busy};
}

/**
 * Inserts a block (its gate form, or `form`) before column `col`. Its data wires go on consecutive wires from `row`; its
 * auxiliary wires (|+⟩ ancillas and readout bits) go on the nearest wires with no gates, or new wires below.
 * @returns {!{circuit: (undefined|!{cols: !Array, init: !Array}), error: (undefined|!string)}}
 */
function insertBlockAt(circuit, block, col, row, form = 'gate') {
    let tpl = block[form];
    let height = rowCount(tpl);
    let isAux = r => (tpl.init[r] || 0) === '+' || tpl.cols.some(c => c[r] === 'QNDread');
    let dataRows = [];
    let auxRows = [];
    for (let r = 0; r < height; r++) {
        (isAux(r) ? auxRows : dataRows).push(r);
    }
    let map = new Map();
    dataRows.forEach((r, i) => map.set(r, row + i));

    // Free wires: nothing on them anywhere, and not one of the block's data wires. Nearest to the block first.
    let taken = new Set(map.values());
    let wireCount = Math.max(rowCount(circuit), row + dataRows.length);
    let free = [];
    for (let w = 0; w < Config.MAX_ROW_COUNT; w++) {
        if (!taken.has(w) && (w >= wireCount || circuit.cols.every(c => isEmpty(c[w])))) {
            free.push(w);
        }
    }
    let last = row + dataRows.length - 1;
    free.sort((a, b) => (a > last ? a - last : row - a + 100) - (b > last ? b - last : row - b + 100));
    if (last >= Config.MAX_ROW_COUNT || free.length < auxRows.length) {
        return {error: `${block.name} doesn't fit here: it needs ${dataRows.length} data wires from wire ${row} ` +
            `and ${auxRows.length} free wires, within Quirk's ${Config.MAX_ROW_COUNT} wires.`};
    }
    // |+⟩ ancillas take the nearest free wires; readout bits go to the bottom, keeping the record below the qubits.
    let isBit = r => tpl.cols.some(c => c[r] === 'QNDread');
    let ancillas = auxRows.filter(r => !isBit(r));
    ancillas.forEach((r, i) => map.set(r, free[i]));
    let bitFree = free.slice(ancillas.length).sort((a, b) => (a >= wireCount ? a : a + 100) - (b >= wireCount ? b : b + 100));
    auxRows.filter(isBit).forEach((r, i) => map.set(r, bitFree[i]));

    let init = [...(circuit.init || [])];
    for (let r of auxRows) {
        let wire = map.get(r);
        while (init.length <= wire) {
            init.push(0);
        }
        init[wire] = tpl.init[r] || 0;
    }
    let blockCols = tpl.cols.map(templateCol => {
        let c = [];
        for (let [r, g] of entriesOf(templateCol)) {
            let w = map.get(r);
            while (c.length <= w) {
                c.push(1);
            }
            c[w] = g;
        }
        return c;
    });
    let cols = [...circuit.cols];
    cols.splice(Math.min(col, cols.length), 0, ...blockCols);
    return {circuit: {cols, init}};
}

export {QND_BLOCKS, compileToQnd, decompileToGate, insertBlockAt, findBlocks, removeBlock, moveBlock, packBitWires,
    unpackBitWires}
