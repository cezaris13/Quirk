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

/**
 * Shared view state for the QND fork: whether QND parity checks are drawn paper-style, as one M_{P⊗k} box.
 */

let compact = true;
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
    set compact(v) {
        compact = !!v;
        QndView.toggled.clear();
        try {
            localStorage.setItem('quirk-qnd-compact', compact ? '1' : '0');
        } catch (_) {
        }
        QndView.requestRedraw();
    },
    isCompact(col) {
        return compact !== QndView.toggled.has(col);
    },
    toggle(col) {
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

export {QndView, qndCheckInColumn}
