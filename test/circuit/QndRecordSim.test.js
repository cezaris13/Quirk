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

import {Suite, assertThat, assertTrue} from "../TestUtil.js"
import {CircuitStats} from "../../src/circuit/CircuitStats.js"
import {recordPlan} from "../../src/circuit/QndRecordSim.js"
import {fromJsonText_CircuitDefinition} from "../../src/circuit/Serializer.js"
import {QND_EXAMPLES} from "../../src/ui/qndExamples.js"

let suite = new Suite("QndRecordSim");

const def = json => fromJsonText_CircuitDefinition(JSON.stringify(json));
const p1 = (stats, row) => stats.controlledWireProbabilityJustAfter(row, Infinity);

suite.test("plan: bit wires leave the simulation, readouts share one scratch qubit", () => {
    let ex = QND_EXAMPLES.find(e => e.id === 'cx-');
    let plan = recordPlan(def(ex.qnd));
    assertThat(plan.qubitRows).isEqualTo([0, 1, 2]);
    assertThat(plan.qdef.numWires).isEqualTo(4);
    assertThat(plan.reads.size).isEqualTo(2);
    assertThat(recordPlan(def({cols: [['H', 'X']]}))).isEqualTo(undefined);
});

suite.testUsingWebGL("BP-CNOT QND form acts as CNOT for every sampled outcome", () => {
    let ex = QND_EXAMPLES.find(e => e.id === 'cx-');
    let c = def({cols: [['X']].concat(ex.qnd.cols), init: ex.qnd.init});
    for (let i = 0; i < 8; i++) {
        let stats = CircuitStats.fromCircuitAtTime(c, 0);
        assertThat(stats.qubitRows).isEqualTo([0, 1, 2]);
        assertThat(p1(stats, 0)).isApproximatelyEqualTo(1);
        assertThat(p1(stats, 2)).isApproximatelyEqualTo(1);    // Target flipped (relocated here).
    }
});

suite.testUsingWebGL("record bits beyond the qubit limit; AND, XOR, anti- and single-bit conditions", () => {
    let bitCount = 20;
    let row = (entries) => {
        let col = [];
        for (let [r, g] of entries) {
            while (col.length <= r) {
                col.push(1);
            }
            col[r] = g;
        }
        return col;
    };
    let cols = [['X']];
    for (let k = 0; k < bitCount; k++) {
        cols.push(row([[0, 'zpar'], [2 + k, 'QNDread']]));
    }
    cols.push(row([[1, 'X'], [2 + bitCount - 1, '•']]));  // Last bit is 1: flip.
    cols.push(row([[1, 'X'], [2, 'zpar'], [3, 'zpar']]));  // 1⊕1 = 0: no flip.
    cols.push(row([[1, 'X'], [2, '•'], [3, '•']]));        // 1·1 = 1: flip back.
    cols.push(row([[1, 'X'], [2, '◦']]));                  // Bit is 1: anti-control doesn't fire.
    cols.push(row([[1, 'zpar'], [2 + bitCount, 'QNDread']]));  // Reads q1 = |0⟩: a 0 bit.
    cols.push(row([[0, 'X'], [2 + bitCount, '◦']]));       // Bit is 0: anti-control fires.
    let c = def({cols});
    assertThat(c.numWires).isEqualTo(3 + bitCount);

    let stats = CircuitStats.fromCircuitAtTime(c, 0);
    assertThat(stats.qubitRows).isEqualTo([0, 1]);
    assertThat(p1(stats, 0)).isApproximatelyEqualTo(0);
    assertThat(p1(stats, 1)).isApproximatelyEqualTo(0);
    assertThat(stats.customStatsForSlot(1, 2)).isEqualTo(true);
    assertThat(stats.finalState.height()).isEqualTo(4);
});

suite.testUsingWebGL("too many qubits gives no results instead of a huge state", () => {
    let c = def({cols: [new Array(18).fill('H')]});
    let stats = CircuitStats.fromCircuitAtTime(c, 0);
    assertTrue(stats.finalState.hasNaN());
});

suite.test("gates other than readouts and controls are disabled on record wires", () => {
    let c = def({cols: [['zpar', 'QNDread'], [1, 'H'], ['X', '•'], [1, '◦', 'X']]});
    assertThat(c.gateAtLocIsDisabledReason(1, 1)).isEqualTo('not allowed\non classical\nwire');
    assertThat(c.gateAtLocIsDisabledReason(2, 1)).isEqualTo(undefined);
    assertThat(c.gateAtLocIsDisabledReason(3, 1)).isEqualTo(undefined);
    assertThat(recordPlan(c).qubitRows).isEqualTo([0, 2]);
});
