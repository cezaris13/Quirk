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
import {toStim} from "../../src/ui/qndStim.js"
import {sampleRecord, findDetectors} from "../../src/ui/qndTableau.js"
import {QND_EXAMPLES} from "../../src/ui/qndExamples.js"

let suite = new Suite("qndStim");

// Instructions only, without the comment lines and the trailing `# c_k` notes.
const body = c => toStim(c).text.split('\n').filter(line => line && line[0] !== '#').
    map(line => line.replace(/\s*#.*$/, ''));

suite.test("BP-CNOT QND form: MPP readouts and rec feedback", () => {
    let ex = QND_EXAMPLES.find(e => e.id === 'cx-');
    assertThat(body(ex.qnd)).isEqualTo([
        'H 2', 'TICK',
        'MPP Z0*Z1*Z2', 'TICK',
        'MX 1', 'TICK',
        'CZ rec[-1] 0', 'TICK',
        'CZ rec[-1] 2', 'TICK',
        'CX rec[-2] 2', 'TICK',
        'RX 1'
    ]);
});

suite.test("XOR conditions become one feedback per record entry", () => {
    let c = {cols: [['zpar', 1, 'QNDread'], ['xpar', 1, 1, 'QNDread'], [1, 'X', 'zpar', 'zpar']], init: []};
    assertThat(body(c)).isEqualTo([
        'M 0', 'TICK', 'MX 0', 'TICK', 'CX rec[-2] 1', 'CX rec[-1] 1'
    ]);
});

suite.test("measurements and corrections are labelled with their record entries", () => {
    let ex = QND_EXAMPLES.find(e => e.id === 'cx-');
    let text = toStim(ex.qnd).text;
    assertThat(text.indexOf('MPP Z0*Z1*Z2  # c0') >= 0).isEqualTo(true);
    assertThat(text.indexOf('CX rec[-2] 2  # X on 2 if c0') >= 0).isEqualTo(true);
});

suite.test("an anti-control on a record bit becomes the Pauli plus its feedback", () => {
    let c = {cols: [['zpar', 1, 'QNDread'], [1, 'X', '◦']], init: []};
    assertThat(body(c)).isEqualTo(['M 0', 'TICK', 'X 1', 'CX rec[-1] 1']);
});

suite.test("a negated X^c argument exports like an anti-control", () => {
    let c = {cols: [['zpar', 1, 'QNDread'], [1, {id: 'X^c', arg: '¬0'}]], init: []};
    assertThat(body(c)).isEqualTo(['M 0', 'TICK', 'X 1', 'CX rec[-1] 1']);
});

suite.test("unsupported parts are reported, not silently dropped", () => {
    let c = {cols: [['•', '•', 'X'], ['H']], init: []};
    let r = toStim(c);
    assertThat(r.problems.length).isEqualTo(1);
    assertThat(body(c)).isEqualTo(['H 0']);
    assertThat(r.text.indexOf('# NOT EXPORTED: column 1') >= 0).isEqualTo(true);
});

suite.test("every paper example exports completely", () => {
    for (let e of QND_EXAMPLES) {
        assertThat(toStim(e.gate).problems).isEqualTo([]);
        assertThat(toStim(e.qnd).problems).isEqualTo([]);
    }
});

suite.test("detectors: a check on its own eigenstate, and an observable", () => {
    // X⊗2 on |++⟩ is deterministic: one detector. c1⊕c2 (the M_X readouts) is the check value again.
    let c = {cols: [['zpar', 'zpar', 'zpar', 'zpar', 1, 'QNDread'],
                    [1, 'xpar', 1, 1, 1, 1, 'QNDread'], [1, 1, 'xpar', 1, 1, 1, 1, 'QNDread']],
             init: ['+', '+', '+', '+']};
    assertThat(toStim(c, {detectors: true}).text.indexOf('DETECTOR rec[-2] rec[-1]  # c1⊕c2') >= 0).isEqualTo(true);
    // As the observable, it's no longer also a detector.
    let r = toStim(c, {detectors: true, observable: '1+2'});
    assertThat(r.text.indexOf('DETECTOR') >= 0).isEqualTo(false);
    assertThat(r.text.indexOf('OBSERVABLE_INCLUDE(0) rec[-2] rec[-1]') >= 0).isEqualTo(true);
    assertThat(r.problems).isEqualTo([]);
    assertThat(toStim(c, {observable: '1'}).problems.length).isEqualTo(1);  // c1 alone is random.
});

suite.test("tableau: Bell pair records agree, X after Z basis is random", () => {
    let ops = [{g: 'H', q: 0}, {g: 'CX', c: 0, t: 1}, {g: 'M', paulis: [['Z', 0]]}, {g: 'M', paulis: [['Z', 1]]},
        {g: 'M', paulis: [['X', 0], ['X', 1]]}];
    let seen = new Set();
    for (let i = 0; i < 40; i++) {
        let rec = sampleRecord(2, ops, Math.random);
        assertThat(rec[0]).isEqualTo(rec[1]);
        seen.add(rec[0]);
    }
    assertThat(seen.size).isEqualTo(2);
    let {detectors} = findDetectors(2, ops, 3);
    assertThat(detectors).isEqualTo([[0, 1]]);
});

suite.test("a record bit not read yet is 0: • never applies, ◦ always does", () => {
    assertThat(body({cols: [[1, 'X', '•'], ['zpar', 1, 'QNDread']], init: []})).isEqualTo(['TICK', 'M 0']);
    assertThat(body({cols: [[1, 'X', '◦'], ['zpar', 1, 'QNDread']], init: []})).isEqualTo(['X 1', 'TICK', 'M 0']);
});

suite.test("an AND of record bits is left out, with the reason", () => {
    let c = {cols: [['zpar', 1, 1, 'QNDread'], [1, 'zpar', 1, 1, 'QNDread'], [1, 1, 'X', '•', '•']], init: []};
    let r = toStim(c, {detectors: true});
    assertThat(r.problems.length).isEqualTo(1);
    assertThat(r.problems[0].indexOf('XOR of measurement results') >= 0).isEqualTo(true);
    assertThat(body(c)).isEqualTo(['M 0', 'TICK', 'M 1']);
});

