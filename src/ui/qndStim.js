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

import {computeRecord, parseRecArg, resolveClassical, RECORD_WIRE_GATES, DISPLAY} from "./qndView.js"
import {findDetectors} from "./qndTableau.js"

/**
 * Export to Stim (https://github.com/quantumlib/Stim). Qubit q is Quirk wire q.
 * - A QND readout is a measurement: MPP for a Pauli product, M / MX / MY for one qubit. It gives a record entry c_k.
 * - A correction controlled by record bits is Stim's classically-controlled gate: `CX rec[-k] q` applies X to q
 *   when that measurement result is 1. XOR conditions (c₀⊕c₁) become one feedback per entry (the corrections are
 *   Paulis, so X^(a⊕b) = X^a·X^b), and an anti-control becomes the Pauli plus its feedback (X^(1⊕a) = X·X^a).
 * - Optional detectors, found automatically (deterministic parities of the record), and a logical observable given
 *   as record entries.
 */

const SINGLE = {
    'H': 'H', 'X': 'X', 'Y': 'Y', 'Z': 'Z',
    'Z^½': 'S', 'Z^-½': 'S_DAG',
    'X^½': 'SQRT_X', 'X^-½': 'SQRT_X_DAG',
    'Y^½': 'SQRT_Y', 'Y^-½': 'SQRT_Y_DAG'
};
const RESET = {'reset0': 'R', 'reset+': 'RX'};
const INIT = {'1': ['X'], '+': ['H'], '-': ['X', 'H'], 'i': ['H', 'S'], '-i': ['H', 'S_DAG']};
const PAULI = /^[XYZ]$/;

const idOf = g => g && typeof g === 'object' ? g.id : g;

/**
 * @param {!{cols: (undefined|!Array), init: (undefined|!Array)}} circuitJson
 * @param {!{detectors: (undefined|!boolean), observable: (undefined|!string)}=} options
 * @returns {!{text: !string, problems: !Array.<!string>}} Stim circuit text; `problems` lists the parts that have
 *     no Stim equivalent and were left out (also listed as comments at the top of the text).
 */
function toStim(circuitJson, options = {}) {
    let circuit = resolveClassical(circuitJson) || circuitJson;
    let cols = circuit.cols || [];
    let init = circuit.init || [];
    let record = computeRecord(cols, init);
    let bits = record.bitRows;
    let problems = [];

    // Ops, each {g, ...targets, note}. Measurements are {g: 'M', paulis: [[axis, qubit], ...]}; feedback has `rec`
    // (absolute record index). Rendered to text below and also run by the tableau simulator for detectors.
    let ops = [];
    let count = 0;
    let recOf = new Map();
    let nameOf = new Map();
    let recByName = new Map();

    init.forEach((v, q) => {
        if (v === 0 || v === '0' || v === undefined || v === null) {
            return;
        }
        let gs = INIT[String(v)];
        if (gs === undefined) {
            problems.push(`wire ${q}: initial state ${v}`);
            return;
        }
        for (let g of gs) {
            ops.push({g, q});
        }
    });
    if (ops.length) {
        ops.push({g: 'TICK'});
    }

    cols.forEach((col, c) => {
        let where = `column ${c + 1}`;
        let cells = [];
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id === 1 || id === undefined || id === null || DISPLAY.test(id)) {
                return;
            }
            if (bits.has(q) && RECORD_WIRE_GATES.indexOf(id) === -1) {
                problems.push(`${where}: ${id} on classical wire ${q} is not allowed (disabled in Quirk too)`);
                return;
            }
            cells.push({q, id});
        });
        if (cells.length === 0) {
            return;
        }
        let reads = cells.filter(e => e.id === 'QNDread');
        let bitCtls = cells.filter(e => bits.has(e.q) && (e.id === '•' || e.id === '◦' || e.id === 'zpar'));
        let ctls = cells.filter(e => !bits.has(e.q) && (e.id === '•' || e.id === '◦'));
        let pars = cells.filter(e => !bits.has(e.q) && /^[xyz]par$/.test(e.id));
        let rest = cells.filter(e => reads.indexOf(e) < 0 && bitCtls.indexOf(e) < 0 &&
            ctls.indexOf(e) < 0 && pars.indexOf(e) < 0);
        let out = [];
        let fail = why => problems.push(`${where}: ${why}`);

        if (reads.length) {
            if (pars.length === 0 || ctls.length || bitCtls.length || rest.length) {
                return fail('QND readout mixed with other gates, or without parity controls');
            }
            for (let r of reads) {
                let k = record.readName.get(`${c}:${r.q}`);
                out.push({g: 'M', paulis: pars.map(e => [e.id[0].toUpperCase(), e.q]), note: `c${k}`});
                recOf.set(r.q, count);
                nameOf.set(r.q, `c${k}`);
                recByName.set(k, count);
                count++;
            }
        } else if (pars.length) {
            return fail('parity-controlled gate without a QND readout');
        } else if (bitCtls.length) {
            if (ctls.length || rest.some(e => !PAULI.test(e.id))) {
                return fail('correction that is not a Pauli conditioned on record bits');
            }
            // A bit wire not read yet holds 0: • on it never holds, ◦ on it always does, and it adds 0 to an XOR.
            let known = bitCtls.filter(b => recOf.has(b.q));
            let xorOfZeros = bitCtls.some(b => b.id === 'zpar') && !known.some(b => b.id === 'zpar');
            if (known.length < bitCtls.length && (xorOfZeros || bitCtls.some(b => b.id === '•' && !recOf.has(b.q)))) {
                out.push({g: 'NOTE', note: `${where}: conditioned on a record bit that is still 0, so it never applies`});
                known = undefined;
            }
            bitCtls = known || [];
            if (known !== undefined && known.length === 0) {
                for (let t of rest) {
                    out.push({g: t.id, q: t.q, note: 'its condition (record bits still 0) always holds'});
                }
            }
            if (bitCtls.length > 1 && bitCtls.some(e => e.id !== 'zpar')) {
                let names = bitCtls.map(b => (b.id === '◦' ? '¬' : '') + nameOf.get(b.q)).join('·');
                return fail(`correction conditioned on ${names}, an AND of record bits. Stim can't express this: ` +
                    `in a Stim circuit every condition is an XOR of measurement results (that's what keeps it a ` +
                    `stabilizer circuit), and an AND isn't one. Left out: the detectors and observable below are ` +
                    `found without it, so they still hold; track this correction in your decoder (Pauli frame), ` +
                    `or use one • / ◦ bit or an XOR (Z-parity controls on the bits) instead.`);
            }
            for (let t of bitCtls.length ? rest : []) {
                let names = bitCtls.map(b => nameOf.get(b.q));
                let not = bitCtls[0].id === '◦';
                let when = not ? `${names[0]} = 0` : names.join('⊕');
                if (not) {
                    out.push({g: t.id, q: t.q, note: `with the next line: ${t.id} on ${t.q} if ${when}`});
                }
                for (let b of bitCtls) {
                    out.push({g: `C${t.id}`, rec: recOf.get(b.q), t: t.q, note: not ? `undone if ${names[0]}` :
                        `${t.id} on ${t.q} if ${nameOf.get(b.q)}` + (bitCtls.length > 1 ? ` (together: if ${when})` : '')});
                }
            }
        } else if (ctls.length) {
            if (ctls.length > 1 || ctls[0].id !== '•' || rest.some(e => !PAULI.test(e.id))) {
                return fail('controlled gate other than a singly-controlled X, Y or Z');
            }
            for (let t of rest) {
                out.push({g: `C${t.id}`, c: ctls[0].q, t: t.q});
            }
        } else {
            let swaps = rest.filter(e => e.id === 'Swap');
            if (swaps.length !== 0 && swaps.length !== 2) {
                return fail('unpaired swap');
            }
            if (swaps.length === 2) {
                out.push({g: 'SWAP', a: swaps[0].q, b: swaps[1].q});
            }
            for (let e of rest) {
                if (e.id === 'Swap') {
                    continue;
                }
                if (e.id === 'Measure') {
                    out.push({g: 'M', paulis: [['Z', e.q]]});
                    count++;
                    continue;
                }
                let g = SINGLE[e.id] || RESET[e.id];
                if (g === undefined) {
                    return fail(`gate ${e.id} has no Stim equivalent`);
                }
                out.push({g, q: e.q});
            }
        }
        for (let op of out) {
            ops.push(op);
        }
        ops.push({g: 'TICK'});
    });
    if (ops.length && ops[ops.length - 1].g === 'TICK') {
        ops.pop();
    }
    let qubits = new Set();
    for (let op of ops) {
        for (let q of [op.q, op.a, op.b, op.c, op.t]) {
            if (q !== undefined) {
                qubits.add(q);
            }
        }
        for (let pq of op.paulis || []) {
            qubits.add(pq[1]);
        }
    }
    let n = Math.max(0, ...qubits) + 1;

    // Render.
    let lines = [];
    let at = 0;
    for (let op of ops) {
        let note = op.note ? `  # ${op.note}` : '';
        if (op.g === 'NOTE') {
            lines.push(`# ${op.note}`);
        } else if (op.g === 'TICK') {
            lines.push('TICK');
        } else if (op.g === 'M') {
            let ps = op.paulis;
            lines.push(ps.length === 1 ?
                `M${ps[0][0] === 'Z' ? '' : ps[0][0]} ${ps[0][1]}${note}` :
                `MPP ${ps.map(e => e[0] + e[1]).join('*')}${note}`);
            at++;
        } else if (op.rec !== undefined) {
            lines.push(`${op.g} rec[-${at - op.rec}] ${op.t}${note}`);
        } else if (op.c !== undefined) {
            lines.push(`${op.g} ${op.c} ${op.t}${note}`);
        } else if (op.g === 'SWAP') {
            lines.push(`SWAP ${op.a} ${op.b}`);
        } else {
            lines.push(`${op.g} ${op.q}${note}`);
        }
    }

    let tail = [];
    let wantObservable = options.observable !== undefined && String(options.observable).trim() !== '';
    if ((options.detectors || wantObservable) && count > 0) {
        let found = findDetectors(n, ops, count);
        let detectors = found.detectors;
        let isDeterministic = found.isDeterministic;
        let recName = new Map();
        for (let [k, i] of recByName.entries()) {
            recName.set(i, `c${k}`);
        }
        let refs = idx => idx.map(i => `rec[-${count - i}]`).join(' ');
        let label = idx => idx.map(i => recName.get(i) || `m${i}`).join('⊕');
        let obsIdx = undefined;
        if (wantObservable) {
            let keys = parseRecArg(options.observable);
            obsIdx = (keys || []).map(k => recByName.get(k));
            if (keys === undefined || obsIdx.length === 0 || obsIdx.some(i => i === undefined)) {
                problems.push(`observable "${options.observable}": not a list of record entries that exist`);
                obsIdx = undefined;
            } else if (!isDeterministic(obsIdx)) {
                problems.push(`observable ${label(obsIdx)} isn't deterministic without noise, so it isn't a logical ` +
                    `observable of this circuit`);
            } else {
                // A deterministic observable is in the span of the detector basis (e.g. X̄ when starting in |+⟩_L).
                // Each basis detector has its own last measurement, and the observable is the sum of the detectors
                // whose last measurement it contains: drop the latest of those, so no detector set equals it.
                let parity = new Map();
                for (let i of obsIdx) {
                    parity.set(i, (parity.get(i) || 0) ^ 1);
                }
                let used = detectors.filter(d => parity.get(d[d.length - 1]) === 1);
                if (used.length > 0) {
                    let drop = used[used.length - 1];
                    detectors = detectors.filter(d => d !== drop);
                }
            }
        }
        if (options.detectors) {
            tail.push(`# Detectors: parities of the record that are fixed when there's no noise (${detectors.length}).`);
            for (let d of detectors) {
                tail.push(`DETECTOR ${refs(d)}  # ${label(d)}`);
            }
        }
        if (obsIdx !== undefined) {
            tail.push(`OBSERVABLE_INCLUDE(0) ${refs(obsIdx)}  # ${label(obsIdx)}`);
        }
    }

    let head = [
        '# Exported from Quirk (QND fork). Qubit q is Quirk wire q.',
        '# QND readouts are measurements (MPP, or M/MX/MY on one qubit) giving record entries c0, c1, ...',
        '# A correction "CX rec[-k] q" is classically controlled: X on q if that measurement result is 1.'];
    for (let problem of problems) {
        head.push(`# NOT EXPORTED: ${problem}`);
    }
    return {text: head.concat(lines, tail).join('\n') + '\n', problems};
}

export {toStim}
