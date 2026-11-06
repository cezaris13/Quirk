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
import {
    QND_BLOCKS, compileToQnd, decompileToGate, insertBlockAt, findBlocks, removeBlock, moveBlock, packBitWires, unpackBitWires
} from "../../src/ui/qndBlocks.js"
import {QND_EXAMPLES} from "../../src/ui/qndExamples.js"
import {computeRecord} from "../../src/ui/qndView.js"

let suite = new Suite("qndBlocks");

const EMPTY = () => ({cols: [], init: []});
const block = prefix => QND_BLOCKS.find(b => b.name.startsWith(prefix));
const rows = c => Math.max(0, ...c.cols.map(col => col.length), (c.init || []).length);
// Column contents without trailing padding, for comparing circuits.
const norm = c => JSON.stringify(c.cols.map(col => {
    let out = col.slice();
    while (out.length && out[out.length - 1] === 1) {
        out.pop();
    }
    return out;
}));
// What each correction is conditioned on: the record entries, independent of which wires hold them.
const conditions = c => JSON.stringify([...computeRecord(c.cols, c.init || []).cond.values()].map(
    v => [v.keys.slice().sort(), v.targets, v.parity]));

suite.test("every block round-trips through its QND form", () => {
    for (let b of QND_BLOCKS) {
        let placed = insertBlockAt(EMPTY(), b, 0, 1).circuit;
        let qnd = compileToQnd(placed);
        assertTrue(qnd !== undefined);
        assertThat(norm(decompileToGate(qnd))).isEqualTo(norm(placed));
    }
});

suite.test("paper examples with block layouts switch both ways", () => {
    for (let id of ['cx-', 'xx-', 'zxxz-']) {
        let ex = QND_EXAMPLES.find(e => e.id === id);
        assertThat(norm(compileToQnd(ex.gate))).isEqualTo(norm(ex.qnd));
        assertThat(norm(decompileToGate(ex.qnd))).isEqualTo(norm(ex.gate));
    }
});

suite.test("compile needs a fresh |+⟩ for the relocation", () => {
    let c = insertBlockAt(EMPTY(), block('BP-CNOT'), 0, 0).circuit;
    assertTrue(compileToQnd(c) !== undefined);
    c.init = c.init.map(() => 0);
    assertThat(compileToQnd(c)).isEqualTo(undefined);
});

suite.test("insertBlockAt puts readout bits below the qubits, and refuses what doesn't fit", () => {
    let c = insertBlockAt(EMPTY(), block('X⊗2'), 0, 0).circuit;
    let bit = c.cols[0].indexOf('QNDread');
    assertThat(bit).isEqualTo(rows(c) - 1);
    assertTrue(insertBlockAt(EMPTY(), block('X⊗4'), 0, 28).error !== undefined);
});

suite.test("packing reuses bit wires between blocks and keeps the record", () => {
    let c = insertBlockAt(EMPTY(), block('BP-CNOT'), 0, 0).circuit;
    c = insertBlockAt(c, block('X⊗2'), 99, 0).circuit;
    let packed = compileToQnd(c);
    let unpacked = unpackBitWires(packed);
    assertTrue(rows(packed) < rows(unpacked));
    assertThat(conditions(packed)).isEqualTo(conditions(unpacked));
    assertThat(norm(packBitWires(unpacked))).isEqualTo(norm(packed));
    assertThat(norm(decompileToGate(packed))).isEqualTo(norm(c));
});

suite.test("packing leaves circuits it can't move safely alone", () => {
    // A bit wire used as a control before anything is read onto it.
    let c = {cols: [[1, 'X', '•'], ['zpar', 'zpar', 'QNDread'], [1, 'Z', '•']], init: []};
    assertThat(packBitWires(c)).isEqualTo(c);
});

suite.test("findBlocks finds blocks in both forms; removeBlock and insertBlockAt move one", () => {
    let c = insertBlockAt(EMPTY(), block('BP-CNOT'), 0, 0).circuit;
    c = insertBlockAt(c, block('X⊗2'), 99, 0).circuit;
    let found = findBlocks(c);
    assertThat(found.map(f => [f.block.name, f.form, f.col, f.len])).isEqualTo([
        ['BP-CNOT (Fig. 2a)', 'gate', 0, 2], ['X⊗2 check (Fig. 2b)', 'gate', 2, 3]]);
    assertThat(findBlocks(compileToQnd(c)).map(f => f.form)).isEqualTo(['qnd', 'qnd']);

    let rest = removeBlock(c, found[0]);
    assertThat(rest.cols.length).isEqualTo(3);
    let moved = insertBlockAt(rest, found[0].block, 3, 1).circuit;
    assertThat(findBlocks(moved).map(f => [f.form, f.col, f.rows[0]])).isEqualTo([['gate', 0, 0], ['gate', 3, 1]]);
});

suite.test("moveBlock keeps the block's shape, re-preparing its ancilla where it lands", () => {
    let c = insertBlockAt(EMPTY(), block('BP-CNOT'), 0, 0).circuit;  // •X on 0,1; |+⟩ ancilla on 2.
    let found = findBlocks(c)[0];
    let r = moveBlock(c, found, 0, 1);
    assertThat(r.recognized).isEqualTo(true);
    assertThat(norm(r.circuit)).isEqualTo(JSON.stringify([[1, '•', 'X'], [1, 1, 'Swap', 'Swap']]));
    assertThat(r.circuit.init).isEqualTo([0, 0, 0, '+']);
    assertTrue(moveBlock(c, found, 0, 29).error !== undefined);

    // In the QND form its readout bits stay on their record wires, and it can't be moved onto them.
    let q = compileToQnd({cols: c.cols.concat([['H']]), init: c.init});
    let found2 = findBlocks(q)[0];
    let moved = moveBlock(q, found2, q.cols.length, 0);
    assertThat(moved.recognized).isEqualTo(true);
    assertThat(moved.circuit.cols[0]).isEqualTo(['H']);
    assertThat(moved.circuit.cols[1].indexOf('QNDread')).isEqualTo(q.cols[0].indexOf('QNDread'));
    assertTrue(moveBlock(q, found2, 0, 1).error.indexOf('record wire') >= 0);
});

suite.test("the QND view of every example shows its blocks, also where the paper reorders or defers steps", () => {
    for (let ex of QND_EXAMPLES.filter(e => e.gate && e.qnd)) {
        assertThat([ex.id, findBlocks(ex.qnd).length]).isEqualTo([ex.id, findBlocks(ex.gate).length]);
    }
});

suite.test("a block's final reset may come later, but not after its wire is used again", () => {
    let q = block('BP-CNOT').qnd;
    let late = {cols: q.cols.slice(0, -1).concat([[], q.cols[q.cols.length - 1]]), init: q.init};
    assertThat(findBlocks(late).map(f => f.len)).isEqualTo([q.cols.length - 1]);
    let reused = {cols: q.cols.slice(0, -1).concat([[1, 'H'], q.cols[q.cols.length - 1]]), init: q.init};
    assertThat(findBlocks(reused).length).isEqualTo(0);
});

suite.test("a moved block's ancilla landing on a used wire: reset to |+⟩ if the wire is done, else reported", () => {
    // BP-CNOT on wires 0-2 (ancilla 2), after an H on wire 3. Moving it down one puts its ancilla on wire 3.
    let c = insertBlockAt({cols: [[1, 1, 1, 'H']], init: []}, block('BP-CNOT'), 1, 0).circuit;
    let found = findBlocks(c)[0];
    let r = moveBlock(c, found, found.col, 1);
    assertThat([r.recognized, r.reset, r.busy]).isEqualTo([true, [3], []]);
    assertThat(r.circuit.cols[1][3]).isEqualTo('reset+');
    // With wire 3 also used after the block, it can't be reset.
    c.cols.push([1, 1, 1, 'X']);
    r = moveBlock(c, findBlocks(c)[0], found.col, 1);
    assertThat([r.recognized, r.reset, r.busy]).isEqualTo([false, [], [3]]);
});
