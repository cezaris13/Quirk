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

import {QndView} from "./qndView.js"

/**
 * Wires up the paper-style checks toggle: the checkbox and the P shortcut switch every QND parity check
 * in the circuit between one M_{P⊗k} box and its expanded parity controls.
 */
function initQnd() {
    let compactBox = document.getElementById('qnd-compact');
    if (compactBox) {
        compactBox.checked = QndView.compact;
        compactBox.addEventListener('change', () => {
            QndView.compact = compactBox.checked;
        });
    }

    document.addEventListener('keydown', e => {
        let t = e.target;
        let typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (typing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key.toLowerCase() === 'p') {
            QndView.compact = !QndView.compact;
            if (compactBox) {
                compactBox.checked = QndView.compact;
            }
        }
    });
}

export {initQnd}
