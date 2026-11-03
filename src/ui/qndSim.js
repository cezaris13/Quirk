/**
 * Copyright 2017 Google Inc.
 *
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
 * A tiny CPU state-vector simulator used by the layout view to show per-qubit Bloch vectors and
 * sampled measurement outcomes up to a given column, without going through the WebGL pipeline.
 */

const s = Math.SQRT1_2;

// 2x2 matrices as flat [m00, m01, m10, m11] lists of [re, im] pairs.
const GATES = {
    H: [[s, 0], [s, 0], [s, 0], [-s, 0]],
    X: [[0, 0], [1, 0], [1, 0], [0, 0]],
    Y: [[0, 0], [0, -1], [0, 1], [0, 0]],
    Z: [[1, 0], [0, 0], [0, 0], [-1, 0]]
};

/**
 * P^t for a Pauli P, i.e. (1+e^{iπt})/2·I + (1-e^{iπt})/2·P.
 * @param {!string} axis
 * @param {!number} t
 */
function pauliPower(axis, t) {
    let c = Math.cos(Math.PI * t);
    let sn = Math.sin(Math.PI * t);
    let a = [(1 + c) / 2, sn / 2];
    let b = [(1 - c) / 2, -sn / 2];
    let p = GATES[axis];
    return [[1, 0], [0, 0], [0, 0], [1, 0]].map((e, k) => [
        a[0] * e[0] - a[1] * e[1] + b[0] * p[k][0] - b[1] * p[k][1],
        a[0] * e[1] + a[1] * e[0] + b[0] * p[k][1] + b[1] * p[k][0]
    ]);
}

const POWER_GATES = {
    'X^½': ['X', 0.5],
    'X^-½': ['X', -0.5],
    'Y^½': ['Y', 0.5],
    'Y^-½': ['Y', -0.5],
    'Z^½': ['Z', 0.5],
    'Z^-½': ['Z', -0.5],
    'X^¼': ['X', 0.25],
    'X^-¼': ['X', -0.25],
    'Y^¼': ['Y', 0.25],
    'Y^-¼': ['Y', -0.25],
    'Z^¼': ['Z', 0.25],
    'Z^-¼': ['Z', -0.25]
};

/** Gates that don't affect the state (displays, classically-controlled record gates). */
const PASSIVE_GATE_PATTERN = /^(Bloch|Chance|Amps|Density|Sample|…|Chance\d+|Amps\d+|Density\d+|Sample\d+|[XYZ]\^c)$/;

class StateVector {
    /**
     * @param {!int} n Number of qubits.
     */
    constructor(n) {
        this.n = n;
        this.re = new Float64Array(1 << n);
        this.im = new Float64Array(1 << n);
        this.re[0] = 1;
    }

    /**
     * @param {!int} q
     * @param {!Array.<!Array.<!number>>} m
     * @param {undefined|null|!function(!int): !boolean} ctrl
     */
    apply1(q, m, ctrl) {
        let bit = 1 << q;
        let dim = 1 << this.n;
        let re = this.re;
        let im = this.im;
        for (let k = 0; k < dim; k++) {
            if ((k & bit) || (ctrl && !ctrl(k))) {
                continue;
            }
            let j = k | bit;
            let ar = re[k], ai = im[k], br = re[j], bi = im[j];
            re[k] = m[0][0] * ar - m[0][1] * ai + m[1][0] * br - m[1][1] * bi;
            im[k] = m[0][0] * ai + m[0][1] * ar + m[1][0] * bi + m[1][1] * br;
            re[j] = m[2][0] * ar - m[2][1] * ai + m[3][0] * br - m[3][1] * bi;
            im[j] = m[2][0] * ai + m[2][1] * ar + m[3][0] * bi + m[3][1] * br;
        }
    }

    /**
     * @param {!int} a
     * @param {!int} b
     * @param {undefined|null|!function(!int): !boolean} ctrl
     */
    swap(a, b, ctrl) {
        let dim = 1 << this.n;
        let ma = 1 << a;
        let mb = 1 << b;
        for (let k = 0; k < dim; k++) {
            if (!(k & ma) || (k & mb) || (ctrl && !ctrl(k))) {
                continue;
            }
            let j = (k & ~ma) | mb;
            let t = this.re[k];
            this.re[k] = this.re[j];
            this.re[j] = t;
            t = this.im[k];
            this.im[k] = this.im[j];
            this.im[j] = t;
        }
    }

    /**
     * Z-basis measurement with collapse.
     * @param {!int} q
     * @param {!function(): !number} rng
     * @returns {!int}
     */
    measure(q, rng) {
        let bit = 1 << q;
        let dim = 1 << this.n;
        let p1 = 0;
        for (let k = 0; k < dim; k++) {
            if (k & bit) {
                p1 += this.re[k] * this.re[k] + this.im[k] * this.im[k];
            }
        }
        let result = rng() < p1 ? 1 : 0;
        let norm = Math.sqrt(result ? p1 : 1 - p1) || 1;
        for (let k = 0; k < dim; k++) {
            if (((k & bit) ? 1 : 0) !== result) {
                this.re[k] = 0;
                this.im[k] = 0;
            } else {
                this.re[k] /= norm;
                this.im[k] /= norm;
            }
        }
        return result;
    }

    /**
     * @param {!int} q
     * @returns {!Array.<!number>} The [x, y, z] Bloch vector of the qubit.
     */
    bloch(q) {
        let bit = 1 << q;
        let dim = 1 << this.n;
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < dim; k++) {
            let p = this.re[k] * this.re[k] + this.im[k] * this.im[k];
            z += (k & bit) ? -p : p;
            if (!(k & bit)) {
                let j = k | bit;
                x += 2 * (this.re[k] * this.re[j] + this.im[k] * this.im[j]);
                y += 2 * (this.re[k] * this.im[j] - this.im[k] * this.re[j]);
            }
        }
        return [x, y, z];
    }
}

/**
 * Seeded PRNG (mulberry32) so that sampled outcomes are stable while editing.
 * @param {!int} seed
 * @returns {!function(): !number}
 */
function mulberry32(seed) {
    return () => {
        let t = seed = (seed + 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function popcount(v) {
    let c = 0;
    while (v) {
        c += v & 1;
        v >>>= 1;
    }
    return c;
}

/**
 * Simulates the circuit's columns 0..upToCol (inclusive).
 * @param {!{cols: (undefined|!Array), init: (undefined|!Array)}} circuitJson
 * @param {!int} upToCol
 * @param {!int} minQubits
 * @param {!int=} seed
 * @returns {!{bloch: !Array.<!Array.<!number>>, outcomes: !Map.<!string, !int>, unsupported: !Set.<!string>, n: !int}}
 */
function simulateUpTo(circuitJson, upToCol, minQubits, seed = 7) {
    let cols = circuitJson.cols || [];
    let n = minQubits;
    for (let col of cols) n = Math.max(n, col.length);
    n = Math.max(1, Math.min(n, 16));

    let state = new StateVector(n);
    let rng = mulberry32((seed >>> 0) || 1);
    let unsupported = new Set();
    let outcomes = new Map();

    (circuitJson.init || []).forEach((v, q) => {
        if (q >= n) {
            return;
        }
        if (v === 1 || v === '1') {
            state.apply1(q, GATES.X);
        } else if (v === '+') {
            state.apply1(q, GATES.H);
        } else if (v === '-') {
            state.apply1(q, GATES.X);
            state.apply1(q, GATES.H);
        } else if (v === 'i') {
            state.apply1(q, GATES.H);
            state.apply1(q, pauliPower('Z', 0.5));
        } else if (v === '-i') {
            state.apply1(q, GATES.H);
            state.apply1(q, pauliPower('Z', -0.5));
        }
    });

    const sDagger = pauliPower('Z', -0.5);
    const sGate = pauliPower('Z', 0.5);
    for (let c = 0; c <= Math.min(upToCol, cols.length - 1); c++) {
        function idOf(g) {
            return g && typeof g === 'object' ? g.id : g;
        }
        let col = cols[c].map(g => g && typeof g === 'object' ? g : g);

        // Controls, anti-controls and parity controls.
        let ctrlMask = 0, antiMask = 0, parityMask = 0;
        let parities = [];
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id === '•') {
                ctrlMask |= 1 << q;
            } else if (id === '◦') {
                antiMask |= 1 << q;
            } else if (id === 'zpar' || id === 'xpar' || id === 'ypar') {
                parityMask |= 1 << q;
                parities.push([q, id[0]]);
            }
        });
        for (let [q, axis] of parities) {
            if (axis === 'x') {
                state.apply1(q, GATES.H);
            } else if (axis === 'y') {
                state.apply1(q, sDagger);
                state.apply1(q, GATES.H);
            }
        }
        let ctrl = ctrlMask || antiMask || parityMask
            ? k => (k & ctrlMask) === ctrlMask &&
                (k & antiMask) === 0 &&
                (!parityMask || (popcount(k & parityMask) & 1) === 1)
            : null;

        let swaps = [];
        col.forEach((g, q) => {
            let id = idOf(g);
            if (id === undefined || id === 1 || id === '•' || id === '◦' || /par$/.test(id) ||
                    PASSIVE_GATE_PATTERN.test(id)) {
                return;
            }
            if (GATES[id]) {
                state.apply1(q, GATES[id], ctrl);
            } else if (POWER_GATES[id]) {
                state.apply1(q, pauliPower(POWER_GATES[id][0], POWER_GATES[id][1]), ctrl);
            } else if (/^[XYZ]\^ft$/.test(id)) {
                let t = parseFloat(g.arg);
                if (isFinite(t)) {
                    state.apply1(q, pauliPower(id[0], t), ctrl);
                } else {
                    unsupported.add(id);
                }
            } else if (id === 'Swap') {
                swaps.push(q);
            } else if (id === 'reset0' || id === 'reset+') {
                if (state.measure(q, rng)) {
                    state.apply1(q, GATES.X);
                }
                if (id === 'reset+') {
                    state.apply1(q, GATES.H);
                }
            } else if (id === 'QNDread') {
                if (state.measure(q, rng)) {
                    state.apply1(q, GATES.X);
                }
                state.apply1(q, GATES.X, ctrl);
                outcomes.set(`${c}:${q}`, state.measure(q, rng));
            } else if (id === 'Measure' || id === 'ZDetector') {
                outcomes.set(`${c}:${q}`, state.measure(q, rng));
            } else {
                unsupported.add(id);
            }
        });
        if (swaps.length === 2) {
            state.swap(swaps[0], swaps[1], ctrl);
        }

        for (let [q, axis] of parities) {
            if (axis === 'x') {
                state.apply1(q, GATES.H);
            } else if (axis === 'y') {
                state.apply1(q, GATES.H);
                state.apply1(q, sGate);
            }
        }
    }

    let bloch = [];
    for (let q = 0; q < n; q++) {
        bloch.push(state.bloch(q));
    }
    return {bloch, outcomes, unsupported, n};
}

export {simulateUpTo}
