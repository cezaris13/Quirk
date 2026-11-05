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
 * A small stabilizer (Aaronson-Gottesman) simulator for the Clifford circuits the Stim export produces, used to
 * sample noiseless measurement records and so find which parities of them are deterministic (detectors).
 * Rows 0..n-1 are destabilizers, n..2n-1 stabilizers; Y is x=z=1. Global phases are ignored.
 */
class Tableau {
    /** @param {!int} n */
    constructor(n) {
        this.n = n;
        this.x = [];
        this.z = [];
        this.r = new Uint8Array(2 * n);
        for (let i = 0; i < 2 * n; i++) {
            this.x.push(new Uint8Array(n));
            this.z.push(new Uint8Array(n));
        }
        for (let i = 0; i < n; i++) {
            this.x[i][i] = 1;
            this.z[n + i][i] = 1;
        }
    }

    h(q) {
        for (let i = 0; i < 2 * this.n; i++) {
            let x = this.x[i][q], z = this.z[i][q];
            this.r[i] ^= x & z;
            this.x[i][q] = z;
            this.z[i][q] = x;
        }
    }

    s(q) {
        for (let i = 0; i < 2 * this.n; i++) {
            this.r[i] ^= this.x[i][q] & this.z[i][q];
            this.z[i][q] ^= this.x[i][q];
        }
    }

    /** Pauli gates only flip signs: X flips rows with Z on q, Z rows with X, Y rows with exactly one. */
    pauli(axis, q) {
        for (let i = 0; i < 2 * this.n; i++) {
            let x = this.x[i][q], z = this.z[i][q];
            this.r[i] ^= axis === 'X' ? z : axis === 'Z' ? x : x ^ z;
        }
    }

    cx(c, t) {
        for (let i = 0; i < 2 * this.n; i++) {
            let xc = this.x[i][c], zc = this.z[i][c], xt = this.x[i][t], zt = this.z[i][t];
            this.r[i] ^= xc & zt & (xt ^ zc ^ 1);
            this.x[i][t] = xt ^ xc;
            this.z[i][c] = zc ^ zt;
        }
    }

    swap(a, b) {
        for (let i = 0; i < 2 * this.n; i++) {
            let x = this.x[i][a], z = this.z[i][a];
            this.x[i][a] = this.x[i][b];
            this.z[i][a] = this.z[i][b];
            this.x[i][b] = x;
            this.z[i][b] = z;
        }
    }

    /** Row h ← row h · row i, with the Aaronson-Gottesman phase rule. */
    _rowsum(hx, hz, hr, ix, iz, ir) {
        let sum = 2 * hr + 2 * ir;
        for (let q = 0; q < this.n; q++) {
            let x1 = ix[q], z1 = iz[q], x2 = hx[q], z2 = hz[q];
            if (x1 && z1) {
                sum += z2 - x2;
            } else if (x1) {
                sum += z2 * (2 * x2 - 1);
            } else if (z1) {
                sum += x2 * (1 - 2 * z2);
            }
            hx[q] ^= x1;
            hz[q] ^= z1;
        }
        return ((sum % 4) + 4) % 4 === 2 ? 1 : 0;
    }

    /**
     * Measures a Pauli product.
     * @param {!Array.<!Array>} paulis [axis, qubit] pairs, e.g. [['X', 0], ['Z', 3]].
     * @param {!function(): !number} rnd
     * @returns {!int} The outcome bit.
     */
    measure(paulis, rnd) {
        let n = this.n;
        let px = new Uint8Array(n), pz = new Uint8Array(n);
        for (let [axis, q] of paulis) {
            px[q] ^= axis !== 'Z' ? 1 : 0;
            pz[q] ^= axis !== 'X' ? 1 : 0;
        }
        let anti = i => {
            let s = 0;
            for (let q = 0; q < n; q++) {
                s ^= (this.x[i][q] & pz[q]) ^ (this.z[i][q] & px[q]);
            }
            return s;
        };
        let p = -1;
        for (let i = n; i < 2 * n; i++) {
            if (anti(i)) {
                p = i;
                break;
            }
        }
        if (p >= 0) {
            for (let i = 0; i < 2 * n; i++) {
                if (i !== p && anti(i)) {
                    this.r[i] = this._rowsum(this.x[i], this.z[i], this.r[i], this.x[p], this.z[p], this.r[p]);
                }
            }
            this.x[p - n] = this.x[p].slice();
            this.z[p - n] = this.z[p].slice();
            this.r[p - n] = this.r[p];
            let outcome = rnd() < 0.5 ? 1 : 0;
            this.x[p] = px;
            this.z[p] = pz;
            this.r[p] = outcome;
            return outcome;
        }
        let sx = new Uint8Array(n), sz = new Uint8Array(n), sr = 0;
        for (let i = 0; i < n; i++) {
            if (anti(i)) {
                sr = this._rowsum(sx, sz, sr, this.x[i + n], this.z[i + n], this.r[i + n]);
            }
        }
        return sr;
    }
}

/**
 * Runs export ops (see qndStim) noiselessly.
 * @param {!int} n Qubit count.
 * @param {!Array.<!Object>} ops
 * @param {!function(): !number} rnd
 * @returns {!Uint8Array} The measurement record.
 */
function sampleRecord(n, ops, rnd) {
    let t = new Tableau(n);
    let rec = [];
    let pauli = (axis, q) => t.pauli(axis, q);
    for (let op of ops) {
        let g = op.g;
        if (g === 'H') {
            t.h(op.q);
        } else if (g === 'S') {
            t.s(op.q);
        } else if (g === 'S_DAG') {
            t.s(op.q); t.s(op.q); t.s(op.q);
        } else if (g === 'SQRT_X') {
            t.h(op.q); t.s(op.q); t.h(op.q);
        } else if (g === 'SQRT_X_DAG') {
            t.h(op.q); t.s(op.q); t.s(op.q); t.s(op.q); t.h(op.q);
        } else if (g === 'SQRT_Y') {
            pauli('Z', op.q); t.h(op.q);
        } else if (g === 'SQRT_Y_DAG') {
            t.h(op.q); pauli('Z', op.q);
        } else if (g === 'X' || g === 'Y' || g === 'Z') {
            pauli(g, op.q);
        } else if (g === 'SWAP') {
            t.swap(op.a, op.b);
        } else if (op.rec !== undefined) {
            if (rec[op.rec]) {
                pauli(g[1], op.t);
            }
        } else if (g === 'CX') {
            t.cx(op.c, op.t);
        } else if (g === 'CZ') {
            t.h(op.t); t.cx(op.c, op.t); t.h(op.t);
        } else if (g === 'CY') {
            t.s(op.t); t.s(op.t); t.s(op.t); t.cx(op.c, op.t); t.s(op.t);
        } else if (g === 'R' || g === 'RX') {
            let axis = g === 'R' ? 'Z' : 'X';
            if (t.measure([[axis, op.q]], rnd)) {
                pauli(axis === 'Z' ? 'X' : 'Z', op.q);
            }
        } else if (g === 'M') {
            rec.push(t.measure(op.paulis, rnd));
        }
    }
    return Uint8Array.from(rec);
}

/**
 * Finds deterministic parities of the measurement record: a basis of detectors, each ending at a different
 * measurement and combining it only with earlier ones.
 * @param {!int} n
 * @param {!Array.<!Object>} ops
 * @param {!int} m Number of measurements.
 * @returns {!{detectors: !Array.<!Array.<!int>>, isDeterministic: !function(!Array.<!int>): !boolean}}
 */
function findDetectors(n, ops, m) {
    let shots = Math.max(256, 2 * m + 64);
    let samples = [];
    for (let i = 0; i < shots; i++) {
        samples.push(sampleRecord(n, ops, Math.random));
    }
    // Rows: how each shot differs from the first. Deterministic parities are exactly its null space.
    let rows = samples.slice(1).map(s => s.map((b, j) => b ^ samples[0][j]));
    let pivotOf = [];
    let rank = 0;
    for (let col = 0; col < m && rank < rows.length; col++) {
        let p = rows.findIndex((row, i) => i >= rank && row[col]);
        if (p < 0) {
            continue;
        }
        let tmp = rows[rank];
        rows[rank] = rows[p];
        rows[p] = tmp;
        for (let i = 0; i < rows.length; i++) {
            if (i !== rank && rows[i][col]) {
                for (let j = 0; j < m; j++) {
                    rows[i][j] ^= rows[rank][j];
                }
            }
        }
        pivotOf.push(col);
        rank++;
    }
    let isPivot = new Set(pivotOf);
    let detectors = [];
    for (let f = 0; f < m; f++) {
        if (isPivot.has(f)) {
            continue;
        }
        let det = [f];
        for (let r = 0; r < rank; r++) {
            if (rows[r][f]) {
                det.push(pivotOf[r]);
            }
        }
        detectors.push(det.sort((a, b) => a - b));
    }
    let isDeterministic = indices => samples.every(s => {
        let a = 0, b = 0;
        for (let j of indices) {
            a ^= s[j];
            b ^= samples[0][j];
        }
        return a === b;
    });
    return {detectors, isDeterministic};
}

export {Tableau, sampleRecord, findDetectors}
