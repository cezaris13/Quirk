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

import {CircuitDefinition} from "./CircuitDefinition.js"
import {GateColumn} from "./GateColumn.js"
import {computeRecord, RECORD_WIRE_GATES} from "../ui/qndView.js"

/**
 * Classical record register for QND readouts. Record-bit wires (only written by QNDread, only used as controls)
 * aren't simulated as qubits: the circuit runs on its qubits plus one scratch qubit, each readout is sampled on
 * the scratch qubit and read back as a classical bit, and a column controlled by bit wires runs only when its
 * condition holds (• bits set, ◦ bits clear, and the XOR of the zpar bits odd), exactly as the controls would act.
 *
 * Gates not allowed on a record wire are disabled there (see CircuitDefinition) and left out.
 *
 * Returns undefined when the circuit has no bit wires or a shape this can't run (two readouts in one column, a
 * readout that is itself conditioned); it's then simulated as usual.
 *
 * @param {!CircuitDefinition} def
 * @returns {undefined|!{qdef: !CircuitDefinition, qubitRows: !Array.<!int>, scratch: !int,
 *     reads: !Map.<!int, !int>, conds: !Map.<!int, !{and: !Array.<!int>, not: !Array.<!int>, xor: !Array.<!int>}>}}
 *     `reads`: column → bit wire written there. `conds`: column → bit wires it's conditioned on.
 */
function recordPlan(def) {
    let cols = def.columns.map(col => col.gates.map(g => g === undefined ? undefined : g.serializedId));
    let init = [];
    for (let row = 0; row < def.numWires; row++) {
        let v = def.customInitialValues.get(row);
        init.push(v === undefined ? 0 : v);
    }
    let bits = computeRecord(cols, init).bitRows;
    if (bits.size === 0) {
        return undefined;
    }

    let qubitRows = [];
    let rowOf = new Map();
    for (let row = 0; row < def.numWires; row++) {
        if (!bits.has(row)) {
            rowOf.set(row, qubitRows.length);
            qubitRows.push(row);
        }
    }
    let scratch = qubitRows.length;
    let reads = new Map();
    let conds = new Map();
    let columns = [];
    for (let c = 0; c < def.columns.length; c++) {
        let gates = new Array(scratch + 1).fill(undefined);
        let and = [];
        let not = [];
        let xor = [];
        let readRow = undefined;
        let src = def.columns[c].gates;
        for (let row = 0; row < src.length; row++) {
            let g = src[row];
            if (g === undefined) {
                continue;
            }
            if (def.gateAtLocIsDisabledReason(c, row) !== undefined) {
                continue;
            }
            if (bits.has(row)) {
                if (RECORD_WIRE_GATES.indexOf(g.serializedId) === -1) {
                    continue;
                }
                if (g.serializedId === 'QNDread') {
                    if (readRow !== undefined) {
                        return undefined;
                    }
                    readRow = row;
                    gates[scratch] = g;
                } else {
                    (g.serializedId === 'zpar' ? xor : g.serializedId === '◦' ? not : and).push(row);
                }
                continue;
            }
            gates[rowOf.get(row)] = g;
        }
        let condCount = and.length + not.length + xor.length;
        if (readRow !== undefined && condCount > 0) {
            return undefined;
        }
        if (readRow !== undefined) {
            reads.set(c, readRow);
        }
        if (condCount > 0) {
            conds.set(c, {and, not, xor});
        }
        columns.push(new GateColumn(gates));
    }

    let initialValues = new Map();
    for (let [row, v] of def.customInitialValues.entries()) {
        if (rowOf.has(row)) {
            initialValues.set(rowOf.get(row), v);
        }
    }
    let qdef = new CircuitDefinition(scratch + 1, columns, 0, new Map(), def.customGateSet, false, initialValues);
    return {qdef, qubitRows, scratch, reads, conds};
}

/**
 * @param {!{and: !Array.<!int>, not: !Array.<!int>, xor: !Array.<!int>}} cond
 * @param {!Map.<!int, !int>} bits Bit wire → its latest readout (unread wires are 0).
 * @returns {!boolean}
 */
function condHolds(cond, bits) {
    let bit = row => bits.get(row) || 0;
    let parity = 0;
    for (let row of cond.xor) {
        parity ^= bit(row);
    }
    return cond.and.every(row => bit(row) === 1) && cond.not.every(row => bit(row) === 0) &&
        (cond.xor.length === 0 || parity === 1);
}

export {recordPlan, condHolds}
