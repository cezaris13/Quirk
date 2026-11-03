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
 * Example circuits from the QND / biased-noise papers.
 *
 * Each example comes in two forms: 'gate' is the textbook circuit and 'qnd' is the same
 * circuit compiled into bias-preserving QND parity readouts plus Pauli-frame corrections.
 * 'coords' optionally places each wire on the 2D layout view, and 'labels' names the wires.
 */
const QND_EXAMPLES = [
    {
        id: "cx-",
        title: "Fig. 2(a): CX from QND Z⊗3",
        ref: "arXiv:2605.24262 Fig. 2(a); arXiv:2607.20143 Fig. 21",
        gate: {
            cols: [
                ["•", "X"],
                [1, "Swap", "Swap"]
            ],
            init: [0, 0, "+"]
        },
        qnd: {
            cols: [
                ["zpar", "zpar", "zpar", "QNDread"],
                [1, "xpar", 1, 1, "QNDread"],
                ["Z", 1, 1, 1, "•"],
                [1, 1, "Z", 1, "•"],
                [1, 1, "X", "•"],
                [1, "reset0"]
            ],
            init: [0, 0, "+"]
        },
        coords: {},
        labels: {
            gate: ["control", "target", "|+⟩"],
            qnd: ["control", "target", "|+⟩", "bit0", "bit1"]
        }
    },
    {
        id: "xx-",
        title: "Fig. 2(b): X⊗2 from QND Z⊗4",
        ref: "arXiv:2605.24262 Fig. 2(b); arXiv:2607.20143 Fig. 5",
        gate: {
            cols: [
                [1, "xpar", "xpar", 1, "QNDread"],
                ["Swap", "Swap"],
                [1, 1, "Swap", "Swap"]
            ],
            init: ["+", 0, 0, "+"]
        },
        qnd: {
            cols: [
                ["zpar", "zpar", "zpar", "zpar", "QNDread"],
                [1, "xpar", 1, 1, 1, "QNDread"],
                [1, 1, "xpar", 1, 1, 1, "QNDread"],
                ["Z", 1, 1, 1, 1, "•"],
                [1, 1, 1, "X", "•"],
                [1, 1, 1, "Z", 1, 1, "•"],
                [1, "reset0", "reset0"]
            ],
            init: ["+", 0, 0, "+"]
        },
        coords: {},
        labels: {
            gate: ["|+⟩", "data 1", "data 2", "|+⟩", "bit0"],
            qnd: ["|+⟩", "data 1", "data 2", "|+⟩", "bit0", "bit1", "bit2"]
        }
    },
    {
        id: "zxxz-",
        title: "Fig. 2(c): ZXXZ check (XZZX code)",
        ref: "arXiv:2605.24262 Fig. 2(c); arXiv:2607.20143 Fig. 24",
        gate: {
            cols: [
                ["zpar", 1, "xpar", "xpar", 1, "zpar", "QNDread"],
                [1, "Swap", "Swap"],
                [1, 1, 1, "Swap", "Swap"]
            ],
            init: [0, "+", 0, 0, "+"]
        },
        qnd: {
            cols: [
                ["•", 1, "Z"],
                [1, 1, 1, "Z", 1, "•"],
                [1, "zpar", "zpar", "zpar", "zpar", 1, "QNDread"],
                [1, 1, "xpar", 1, 1, 1, 1, "QNDread"],
                [1, 1, 1, "xpar", 1, 1, 1, 1, "QNDread"],
                ["•", "Z"],
                [1, 1, 1, 1, "Z", "•"],
                [1, "Z", 1, 1, 1, 1, 1, "•"],
                [1, 1, 1, 1, "X", 1, "•"],
                [1, 1, 1, 1, 1, "Z", "•"],
                [1, 1, 1, 1, "Z", 1, 1, 1, "•"],
                [1, 1, "reset0", "reset0"]
            ],
            init: [0, "+", 0, 0, "+"]
        },
        coords: {},
        labels: {
            gate: ["data Z", "|+⟩", "data X", "data X", "|+⟩", "data Z", "bit0"],
            qnd: ["data Z", "|+⟩", "data X", "data X", "|+⟩", "data Z", "bit0", "bit1", "bit2"]
        }
    }
];

export {QND_EXAMPLES}
