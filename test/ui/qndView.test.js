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

import {Suite, assertThat} from "../TestUtil.js"
import {computeRecord, resolveClassical, circuitResources} from "../../src/ui/qndView.js"
import {QND_EXAMPLES} from "../../src/ui/qndExamples.js"

let suite = new Suite("qndView");

// Two readouts onto bit wires 4 and 5, then the given correction columns.
const withReads = (...cols) => [
    ['zpar', 'zpar', 1, 1, 'QNDread'],
    [1, 'zpar', 'zpar', 1, 1, 'QNDread']
].concat(cols);

suite.test("adjacent single-bit corrections with the same Paulis show as one XOR gate", () => {
    let rec = computeRecord(withReads(['X', 1, 1, 1, '•'], ['X', 1, 1, 1, 1, '•']), [0, '+']);
    assertThat(rec.cond.get(2).keys).isEqualTo([0, 1]);
    assertThat(rec.cond.get(2).parity).isEqualTo(true);
    assertThat(rec.mergedInto.get(3)).isEqualTo(2);
});

suite.test("corrections on different targets or Paulis, or an AND, stay separate", () => {
    let otherTarget = computeRecord(withReads(['X', 1, 1, 1, '•'], [1, 'X', 1, 1, 1, '•']), [0, '+']);
    let otherPauli = computeRecord(withReads(['X', 1, 1, 1, '•'], ['Z', 1, 1, 1, 1, '•']), [0, '+']);
    let and = computeRecord(withReads(['X', 1, 1, 1, '•', '•'], ['X', 1, 1, 1, '•']), [0, '+']);
    assertThat([otherTarget.mergedInto.size, otherPauli.mergedInto.size, and.mergedInto.size]).isEqualTo([0, 0, 0]);
});

suite.test("an X^c gate with AND resolves to plain controls, XOR to Z-parity controls on the bit wires", () => {
    let c = arg => ({cols: withReads([{id: 'X^c', arg}]), init: [0, '+']});
    assertThat(resolveClassical(c('0*1')).cols.slice(2)).isEqualTo([['X', 1, 1, 1, '•', '•']]);
    assertThat(resolveClassical(c('0+1')).cols.slice(2)).isEqualTo([['X', 1, 1, 1, 'zpar', 'zpar']]);
});

suite.test("a Z-parity correction is one XOR gate; an adjacent one repeating an entry is not merged", () => {
    let rec = computeRecord(withReads(['X', 1, 1, 1, 'zpar', 'zpar'], ['X', 1, 1, 1, '•']), [0, '+']);
    assertThat(rec.cond.get(2).keys).isEqualTo([0, 1]);
    assertThat(rec.mergedInto.size).isEqualTo(0);  // c0⊕c1 then c0 would repeat c0.
});

suite.test("resource counts: BP-CNOT gate form vs QND form", () => {
    let ex = QND_EXAMPLES.find(e => e.id === 'cx-');
    assertThat(circuitResources(ex.gate)).isEqualTo(
        {qubits: 3, bits: 0, readouts: 0, maxWeight: 0, twoQubit: 1, swaps: 1, corrections: 0, resets: 0, depth: 2});
    assertThat(circuitResources(ex.qnd)).isEqualTo(
        {qubits: 3, bits: 2, readouts: 2, maxWeight: 3, twoQubit: 0, swaps: 0, corrections: 3, resets: 1, depth: 6});
});
