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
import {closeMenu} from "./menu.js"
import {QndView, computeRecord, parseRecArg, resolveClassical, COND_RE} from "./qndView.js"

function initTheme() {
    let button = document.getElementById('theme-button');
    let show = theme => {
        let root = document.documentElement;
        // Switch at once, without the buttons' hover fade lagging behind the canvas.
        root.classList.add('theme-switching');
        root.setAttribute('data-theme', theme);
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
        Config.setDarkTheme(theme === 'dark');
        QndView.requestRedraw();
        if (button) {
            button.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
        }
    };
    let apply = (theme, persist) => {
        show(theme);
        if (persist) {
            try {
                localStorage.setItem('quirk-theme', theme);
            } catch (_) {
                // Storage may be unavailable (e.g. sandboxed frame).
            }
        }
    };
    show(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    if (button) {
        button.addEventListener('click', () => apply(
            document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark',
            true));
    }
    window.addEventListener('message', e => {
        if (e.data && e.data.type === 'qnd-theme' && (e.data.theme === 'dark' || e.data.theme === 'light')) {
            apply(e.data.theme, false);
        }
    });
}

/**
 * Shows the text in the element, turning each arXiv id (e.g. "arXiv:2605.24262") into a link to the paper.
 * @param {!HTMLElement} element
 * @param {!string} text
 */
function showWithArxivLinks(element, text) {
    element.textContent = '';
    for (let part of text.split(/(arXiv:\d{4}\.\d{4,5})/)) {
        if (!/^arXiv:/.test(part)) {
            element.appendChild(document.createTextNode(part));
            continue;
        }
        let link = document.createElement('a');
        link.href = 'https://arxiv.org/abs/' + part.slice('arXiv:'.length);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = part;
        element.appendChild(link);
    }
}

/**
 * @param {!Revision} revision
 */
function initQnd(revision) {
    initTheme();

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

    let select = document.getElementById('qnd-example');
    let viewBox = document.getElementById('qnd-view');
    let info = document.getElementById('qnd-info');
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

    if (!select) {
        return;
    }

    const NONE = -1;
    const FROM_LAB = -2;
    let current = NONE;
    let view = 'qnd';
    let loadedCommit = undefined;
    let labExample = undefined;
    let exampleAt = index => index === FROM_LAB ? labExample : QND_EXAMPLES[index];
    let placeholder = document.createElement('option');
    placeholder.value = '-1';
    placeholder.textContent = 'Load a circuit from the papers…';
    select.appendChild(placeholder);
    // Exact figures from the papers first, then the adapted / extended circuits.
    let paperGroup = document.createElement('optgroup');
    paperGroup.label = 'From the papers (exact figures)';
    let advancedGroup = document.createElement('optgroup');
    advancedGroup.label = 'Adapted & advanced';
    QND_EXAMPLES.forEach((ex, i) => {
        let opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = ex.title;
        (ex.fromPaper ? paperGroup : advancedGroup).appendChild(opt);
    });
    select.appendChild(paperGroup);
    select.appendChild(advancedGroup);

    let refresh = () => {
        viewBox.checked = view === 'qnd';
        viewBox.disabled = true;
        if (current === NONE) {
            info.textContent = 'Pick a paper circuit, then switch views. ' +
                'New gates are in the toolbox group "QND (biased noise)": ' +
                'put Z-/X-parity controls on the measured qubits and a QND readout gate on a spare wire in the same column.';
            return;
        }
        let ex = exampleAt(current);
        viewBox.disabled = !ex.gate || !ex.qnd;
        let wires = ex.labels[view].map((label, i) => i + ':' + label).join('  ');
        let edited = loadedCommit !== undefined && revision.peekActiveCommit() !== loadedCommit ? '  (edited)' : '';
        showWithArxivLinks(info, ex.ref + edited + '. Wires: ' + wires + '. ' + (view === 'qnd'
            ? 'Readout outcomes are sampled: watch them flicker while the corrected output stays the same.'
            : 'Ideal Pauli measurements with relocation swaps, as on the left-hand side of Fig. 2.'));
    };

    let load = () => {
        if (current === NONE) {
            refresh();
            return;
        }
        let ex = exampleAt(current);
        if (!ex[view]) {
            view = ex.qnd ? 'qnd' : 'gate';
        }
        let text = JSON.stringify(ex[view]);
        revision.commit(text);
        loadedCommit = revision.peekActiveCommit();
        refresh();
    };

    select.addEventListener('change', () => {
        current = parseInt(select.value, 10);
        load();
    });
    viewBox.addEventListener('change', () => {
        view = viewBox.checked ? 'qnd' : 'gate';
        load();
    });
    // Q: switch the loaded paper circuit between its gate and QND versions.
    document.addEventListener('keydown', e => {
        let t = e.target;
        let typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (typing || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'q' || viewBox.disabled) {
            return;
        }
        viewBox.checked = !viewBox.checked;
        viewBox.dispatchEvent(new Event('change'));
        e.preventDefault();
    });
    revision.latestActiveCommit().subscribe(refresh);
    refresh();

    // Messages from an embedding page (e.g. the QND·QEC lab).
    window.addEventListener('message', e => {
        let msg = e.data;
        if (msg && msg.type === 'qnd-load') {
            labExample = msg;
            let opt = select.querySelector('option[value="-2"]');
            if (!opt) {
                opt = document.createElement('option');
                opt.value = '-2';
                select.insertBefore(opt, select.children[1]);
            }
            opt.textContent = 'From the lab: ' + msg.title;
            select.value = '-2';
            current = FROM_LAB;
            view = msg.view || 'qnd';
            closeMenu();
            load();
        }
    });
    if (window.parent !== window) {
        closeMenu();
        window.parent.postMessage({type: 'qnd-ready'}, '*');
    }

    // Links in the welcome menu.
    let menuLinks = document.getElementById('qnd-menu-links');
    if (menuLinks) {
        let addLink = (text, href, onClick) => {
            let a = document.createElement('a');
            a.textContent = text;
            a.href = href;
            a.onclick = ev => {
                // Let modified clicks open the link normally.
                if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.which !== 1) {
                    return undefined;
                }
                onClick();
                load();
                closeMenu();
                return false;
            };
            menuLinks.appendChild(a);
            menuLinks.appendChild(document.createElement('br'));
        };
        let addExample = (ex, i) => addLink(ex.title, '#circuit=' + JSON.stringify(ex.qnd), () => {
            select.value = String(i);
            current = i;
            view = 'qnd';
        });
        QND_EXAMPLES.forEach((ex, i) => ex.fromPaper && addExample(ex, i));
        let advancedLabel = document.createElement('div');
        advancedLabel.className = 'qnd-menu-sub';
        advancedLabel.textContent = 'Adapted & advanced';
        menuLinks.appendChild(advancedLabel);
        QND_EXAMPLES.forEach((ex, i) => ex.fromPaper || addExample(ex, i));
    }
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
