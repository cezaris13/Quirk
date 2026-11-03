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

import {QndView, computeRecord, parseRecArg, resolveClassical, COND_RE} from "./qndView.js"

/**
 * @param {!Revision} revision
 */
function initQnd(revision) {

    // Resolve classical-record references whenever a circuit is committed.
    let originalCommit = revision.commit.bind(revision);
    revision.commit = text => {
        try {
            let resolved = resolveClassical(JSON.parse(text));
            if (resolved !== undefined) {
                text = JSON.stringify(resolved);
            }
        } catch (_) {
            // Not our job to report bad JSON.
        }
        originalCommit(text);
    };

    if (document.fonts && document.fonts.load) {
        document.fonts.load('15px QndMath', '⊗⊕').then(() => QndView.requestRedraw(), () => {});
    }

    let compactBox = document.getElementById('qnd-compact');
    if (compactBox) {
        compactBox.checked = QndView.compact;
        compactBox.addEventListener('change', () => {
            QndView.compact = compactBox.checked;
        });
    }

    let recordBox = document.getElementById('qnd-record');
    if (recordBox) {
        recordBox.checked = QndView.record;
        recordBox.addEventListener('change', () => {
            QndView.record = recordBox.checked;
        });
    }

    let tabsBox = document.getElementById('qnd-tabs');
    if (tabsBox) {
        tabsBox.checked = QndView.tabs;
        tabsBox.addEventListener('change', () => {
            QndView.tabs = tabsBox.checked;
        });
    }

    // Keyboard shortcuts: P (paper-style checks), I (input tabs), C (classical record).
    document.addEventListener('keydown', e => {
        let t = e.target;
        let typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (typing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        let key = e.key.toLowerCase();
        if (key === 'p') {
            QndView.compact = !QndView.compact;
            if (compactBox) {
                compactBox.checked = QndView.compact;
            }
        } else if (key === 'i') {
            QndView.tabs = !QndView.tabs;
            if (tabsBox) {
                tabsBox.checked = QndView.tabs;
            }
        } else if (key === 'c') {
            QndView.record = !QndView.record;
            if (recordBox) {
                recordBox.checked = QndView.record;
            }
        } else {
            return;
        }
        e.preventDefault();
    });

    // Expanded/collapsed checks are keyed by column, so forget them when columns are added or removed.
    let lastColCount = -1;
    revision.latestActiveCommit().subscribe(text => {
        try {
            let n = JSON.parse(text).cols.length;
            if (n !== lastColCount) {
                QndView.toggled.clear();
                lastColCount = n;
            }
        } catch (_) {
            // Ignore unparsable circuits.
        }
    });

}

/**
 * Shows a small text-input popup below the given rectangle.
 * @param {!DOMRect} rect
 * @param {!string} label
 * @param {!string} value
 * @param {!string} helpHtml
 * @param {!function(!string)} onApply
 * @param {undefined|!{text: !string, fn: !function()}} extraButton
 */
function showPopupEditor(rect, label, value, helpHtml, onApply, extraButton) {
    let old = document.getElementById('qnd-exp-edit');
    if (old) {
        old.remove();
    }
    let box = document.createElement('div');
    box.id = 'qnd-exp-edit';
    box.style.left = Math.round(rect.left) + 'px';
    box.style.top = Math.round(rect.top + rect.height + 4) + 'px';
    box.innerHTML = '<label>' + label + ' <input type="text" spellcheck="false" autocomplete="off"></label>' +
        '<small>' + helpHtml + '</small>' +
        (extraButton ? '<button type="button" class="qx">' + extraButton.text + '</button>' : '');
    document.body.appendChild(box);
    let input = box.querySelector('input');
    input.value = value;
    input.focus();
    input.select();
    let closed = false;
    let close = () => {
        closed = true;
        box.remove();
    };
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            let text = input.value.trim();
            close();
            onApply(text);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            close();
            e.preventDefault();
        }
    });
    if (extraButton) {
        let button = box.querySelector('button.qx');
        button.addEventListener('mousedown', e => e.preventDefault());
        button.addEventListener('click', () => {
            close();
            extraButton.fn();
        });
    }
    input.addEventListener('blur', () => {
        if (!closed) {
            close();
        }
    });
}

/**
 * @param {!Revision} revision
 * @param {!DOMRect} rect
 * @param {!int} col
 * @param {!int} row
 * @param {!string} current
 */
function editClassicalExponent(revision, rect, col, row, current) {
    showPopupEditor(
        rect,
        'record entry',
        current,
        '<b>6</b> → c₆ &nbsp;·&nbsp; <b>6+2</b> → c₆ xor c₂<br>Enter applies, Esc cancels.',
        text => applyClassicalArg(revision, col, row, text));
}

/**
 * Points a classically controlled gate (or turns a plain Pauli under a parity condition into one)
 * at the given record entries.
 * @param {!Revision} revision
 * @param {!int} col
 * @param {!int} row
 * @param {!string} text
 */
function applyClassicalArg(revision, col, row, text) {
    let entries = parseRecArg(text);
    if (entries === undefined) {
        return;
    }
    let circuit;
    try {
        circuit = JSON.parse(revision.peekActiveCommit());
    } catch (_) {
        return;
    }
    let column = circuit.cols[col];
    if (!column) {
        return;
    }
    function idOf(g) {
        return g && typeof g === 'object' ? g.id : g;
    }
    let gate = column[row];
    if (COND_RE.test(idOf(gate) || '')) {
        column[row] = {id: idOf(gate), arg: entries.join('+')};
    } else {
        if (typeof gate !== 'string' || !/^[XYZ]$/.test(gate)) {
            return;
        }
        let cond = computeRecord(
            circuit.cols.map(c => c.map(g => g === 1 || g === null ? undefined : g)),
            circuit.init || []).cond.get(col);
        if (!cond) {
            return;
        }
        column[row] = {id: gate + '^c', arg: entries.join('+')};

        // Drop the old bit-wire controls if nothing else in the column uses them.
        if (cond.targets.every(r => r === row || column[r] === 1 || column[r] === undefined)) {
            for (let r of cond.ctlRows) {
                column[r] = 1;
            }
        }

        // Move the gate into its own column if anything else is left beside it.
        if (column.some((g, r) => r !== row && g !== 1 && g !== undefined && g !== null)) {
            let newCol = [];
            while (newCol.length <= row) {
                newCol.push(1);
            }
            newCol[row] = column[row];
            column[row] = 1;
            circuit.cols.splice(col + 1, 0, newCol);
        }
    }
    revision.commit(JSON.stringify(circuit));
}

/**
 * @param {!Revision} revision
 * @param {!DOMRect} rect
 * @param {!int} col
 * @param {!int} row
 * @param {!string} current
 * @param {undefined|!function()} showAsMarkers
 */
function editReadoutName(revision, rect, col, row, current, showAsMarkers) {
    showPopupEditor(
        rect,
        'store outcome to c',
        current,
        'a number, e.g. <b>5</b> → c₅ (storing to a name again overwrites it, like a variable); ' +
            'empty = automatic (its position in time order).<br>Enter applies, Esc cancels.',
        text => {
            let circuit;
            try {
                circuit = JSON.parse(revision.peekActiveCommit());
            } catch (_) {
                return;
            }
            let column = circuit.cols[col];
            if (!column) {
                return;
            }
            let entries = parseRecArg(text);
            column[row] = entries === undefined ? 'QNDread' : {id: 'QNDread', arg: String(entries[0])};
            revision.commit(JSON.stringify(circuit));
        },
        showAsMarkers ? {text: 'show as parity markers', fn: showAsMarkers} : undefined);
}

export {initQnd, editClassicalExponent, editReadoutName}
