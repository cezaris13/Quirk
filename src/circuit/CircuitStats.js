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

import {CircuitDefinition} from "./CircuitDefinition.js"
import {CircuitEvalContext} from "./CircuitEvalContext.js"
import {CircuitShaders} from "./CircuitShaders.js"
import {KetTextureUtil} from "./KetTextureUtil.js"
import {Controls} from "./Controls.js"
import {DetailedError} from "../base/DetailedError.js"
import {Matrix, complexVectorToReadableJson} from "../math/Matrix.js"
import {Shaders} from "../webgl/Shaders.js"
import {Serializer} from "./Serializer.js"
import {Util} from "../base/Util.js"
import {notifyAboutRecoveryFromUnexpectedError} from "../fallback.js"
import {advanceStateWithCircuit} from "./CircuitComputeUtil.js"
import {currentShaderCoder} from "../webgl/ShaderCoders.js"
import {WglTextureTrader} from "../webgl/WglTextureTrader.js"
import {GateShaders} from "./GateShaders.js"
import {Config} from "../Config.js"
import {recordPlan, condHolds} from "./QndRecordSim.js"

class CircuitStats {
    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @param {!number} time
     * @param {!Array.<!number>} survivalRates
     * @param {!Array.<!Array.<!Matrix>>} singleQubitDensities
     * @param {!Matrix} finalState
     * @param {!Map<!string, *>} customStatsProcessed
     * @param {undefined|!Array.<!int>} qubitRows When QND record bits were simulated classically: the circuit
     *     wires that are qubits, in the order of finalState's bits. Undefined when every wire is a qubit.
     */
    constructor(circuitDefinition,
                time,
                survivalRates,
                singleQubitDensities,
                finalState,
                customStatsProcessed,
                qubitRows=undefined) {
        /**
         * The circuit that these stats apply to.
         * @type {!CircuitDefinition}
         */
        this.circuitDefinition = circuitDefinition;
        /**
         * The time these stats apply to.
         * @type {!number}
         */
        this.time = time;
        /**
         * @type {!Array.<!number>}
         * @private
         */
        this._survivalRates = survivalRates;
        /**
         * The density matrix of individual qubits.
         * (This case is special-cased, instead of using customStats like the other density displays, because
         *  single-qubit displays are so much more common. Also they appear in bulk at the end of the circuit.)
         * @type {!Array.<!Array.<!Matrix>>}
         * @private
         */
        this._qubitDensities = singleQubitDensities;
        /**
         * The output quantum superposition, as a column vector.
         * @type {!Matrix}
         */
        this.finalState = finalState;
        /**
         * @type {!Map.<!string, *>}
         * @private
         */
        this._customStatsProcessed = customStatsProcessed;
        /** @type {undefined|!Array.<!int>} */
        this.qubitRows = qubitRows;
    }

    /**
     * Returns the density matrix of a qubit at a particular point in the circuit.
     *
     * Note: only available if there was a corresponding display gate at that position. Otherwise result is NaN.
     *
     * @param {!int} colIndex
     * @param {!int} wireIndex
     * @returns {!Matrix}
     */
    qubitDensityMatrix(colIndex, wireIndex) {
        if (wireIndex < 0) {
            throw new DetailedError("Bad wireIndex", {wireIndex, colIndex});
        }

        // The initial state is all-qubits-off.
        if (colIndex < 0 || wireIndex >= this.circuitDefinition.numWires) {
            if (wireIndex >= this.circuitDefinition.numWires && this.qubitDensityMatrix(colIndex, 0).hasNaN()) {
                return Matrix.zero(2, 2).times(NaN);
            }
            let buf = new Float32Array(8);
            buf[0] = 1;
            return new Matrix(2, 2, buf);
        }

        let col = Math.min(colIndex, this._qubitDensities.length - 1);
        if (col < 0 || wireIndex >= this._qubitDensities[col].length) {
            return Matrix.zero(2, 2).times(NaN);
        }
        return this._qubitDensities[col][wireIndex];
    }

    /**
     * Converts the circuit stats into an exportable JSON object.
     * @param {!boolean} includeOutputAmplitudes
     * @returns {!object}
     */
    toReadableJson(includeOutputAmplitudes=true) {
        let result = {
            time_parameter: this.time,
            circuit: Serializer.toJson(this.circuitDefinition),
            chance_of_surviving_to_each_column: this._survivalRates,
            computed_bloch_vectors_by_column_then_wire: this._qubitDensities.map(
                col => col.map(singleQubitDensityMatrixToReadableJson)
            ),
            displays: this._customStatsToReadableJson()
        };
        if (includeOutputAmplitudes) {
            result['output_amplitudes'] = complexVectorToReadableJson(this.finalState.getColumn(0));
        }
        return result;
    }

    _customStatsToReadableJson() {
        let result = [];
        for (let [key, data] of this._customStatsProcessed.entries()) {
            let [col, row] = key.split(':');
            row = parseInt(row);
            col = parseInt(col);
            let gate = this.circuitDefinition.columns[col].gates[row];
            if (gate.processedStatsToJsonFunc !== undefined) {
                data = gate.processedStatsToJsonFunc(data);
            }
            result.push({
                location: {
                    wire: row,
                    column: col,
                },
                type: {
                    serialized_id: gate.serializedId,
                    name: gate.name,
                },
                data
            });
        }
        return result;
    }

    /**
     * Determines how often the circuit evaluation survives to the given column, without being post-selected out.
     *
     * Note that over-unitary gates will increase this number, so perhaps 'survival rate' isn't quite the best name.
     *
     * @param {!int} colIndex
     * @returns {!number}
     */
    survivalRate(colIndex) {
        colIndex = Math.min(colIndex, this._survivalRates.length - 1);
        return colIndex < 0 ? 1 : this._survivalRates[colIndex];
    }

    /**
     * @param {!int} col
     * @param {!int} row
     * @returns {undefined|*}
     */
    customStatsForSlot(col, row) {
        let key = col+":"+row;
        return this._customStatsProcessed.has(key) ? this._customStatsProcessed.get(key) : undefined;
    }

    /**
     * Returns the probability that a wire would be on if it was measured just before a given column, but conditioned on
     * wires with controls in that column matching their controls.
     * A wire is never conditioned on itself; self-conditions are ignored when computing the probability.
     *
     * @param {int} wireIndex
     * @param {int|Infinity} colIndex
     * @returns {!number}
     */
    controlledWireProbabilityJustAfter(wireIndex, colIndex) {
        return this.qubitDensityMatrix(colIndex, wireIndex).rawBuffer()[6];
    }

    /**
     * @param {!number} time
     * @returns {!CircuitStats}
     */
    withTime(time) {
        return new CircuitStats(
            this.circuitDefinition,
            time,
            this._survivalRates,
            this._qubitDensities,
            this.finalState,
            this._customStatsProcessed,
            this.qubitRows);
    }

    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @param {!number} time
     * @returns {!CircuitStats}
     */
    static withNanDataFromCircuitAtTime(circuitDefinition, time) {
        return new CircuitStats(
            circuitDefinition,
            time,
            [1],
            [],
            Matrix.zero(1, 1 << Math.min(circuitDefinition.numWires, Config.MAX_WIRE_COUNT)).times(NaN),
            new Map());
    }

    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @param {!number} time
     * @returns {!CircuitStats}
     */
    static fromCircuitAtTime(circuitDefinition, time) {
        try {
            let plan = recordPlan(circuitDefinition);
            if (plan !== undefined && plan.qdef.numWires <= Config.MAX_WIRE_COUNT) {
                return CircuitStats._fromCircuitWithRecord(circuitDefinition, time, plan);
            }
            if (circuitDefinition.numWires > Config.MAX_WIRE_COUNT) {
                // More qubits than can be simulated (QND record bits aside): no results, rather than a huge state.
                return CircuitStats.withNanDataFromCircuitAtTime(circuitDefinition, time);
            }
            return CircuitStats._fromCircuitAtTime_noFallback(circuitDefinition, time);
        } catch (ex) {
            notifyAboutRecoveryFromUnexpectedError(
                `Defaulted to NaN results. Computing circuit values failed.`,
                {circuitDefinition: Serializer.toJson(circuitDefinition)},
                ex);
            return CircuitStats.withNanDataFromCircuitAtTime(circuitDefinition, time);
        }
    }

    /**
     * Returns the same density matrix, but without any diagonal terms related to qubits that have been measured.
     * @param {!Matrix} densityMatrix
     * @param {!int} isMeasuredMask A bitmask where each 1 corresponds to a measured qubit position.
     * @returns {!Matrix}
     */
    static decohereMeasuredBitsInDensityMatrix(densityMatrix, isMeasuredMask) {
        if (isMeasuredMask === 0) {
            return densityMatrix;
        }

        let buf = new Float32Array(densityMatrix.rawBuffer());
        let n = densityMatrix.width();
        for (let row = 0; row < n; row++) {
            for (let col = 0; col < n; col++) {
                if (((row ^ col) & isMeasuredMask) !== 0) {
                    let k = (row*n + col)*2;
                    buf[k] = 0;
                    buf[k+1] = 0;
                }
            }
        }
        return new Matrix(n, n, buf);
    }

    /**
     * @param {!Array.<!Matrix>} rawMatrices
     * @param {!int} numWires
     * @param {!int} qubitSpan
     * @param {!int} isMeasuredMask
     * @param {!int} hasDisplayMask
     * @returns {!Array.<!Matrix>}
     */
    static scatterAndDecohereDensities(rawMatrices, numWires, qubitSpan, isMeasuredMask, hasDisplayMask) {
        let nanMatrix = Matrix.zero(1 << qubitSpan, 1 << qubitSpan).times(NaN);
        let used = 0;
        let result = [];
        for (let row = 0; row < numWires - qubitSpan + 1; row++) {
            if ((hasDisplayMask & (1 << row)) === 0) {
                result.push(nanMatrix);
            } else {
                result.push(CircuitStats.decohereMeasuredBitsInDensityMatrix(
                    rawMatrices[used++],
                    (isMeasuredMask >> row) & ((1 << qubitSpan) - 1)));
            }
        }
        return result;
    }

    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @param {!Array.<!Float32Array>} colQubitDensitiesPixelData
     * @returns {!Array.<!Array<!Matrix>>}
     * @private
     */
    static _extractColumnQubitStatsFromPixelDatas(circuitDefinition, colQubitDensitiesPixelData) {
        let qubitDensityGrid = [];
        for (let col = 0; col < colQubitDensitiesPixelData.length; col++) {
            let dataHasStatsMask = col === circuitDefinition.columns.length ?
                -1 : // All wires have an output display in the after-last column.
                circuitDefinition.colDesiredSingleQubitStatsMask(col);
            qubitDensityGrid.push(CircuitStats.scatterAndDecohereDensities(
                KetTextureUtil.pixelsToQubitDensityMatrices(colQubitDensitiesPixelData[col]),
                circuitDefinition.numWires,
                1,
                circuitDefinition.colIsMeasuredMask(col),
                dataHasStatsMask));
        }

        return qubitDensityGrid;
    }

    /**
     * @param {!Array.<!Float32Array>} normsPixelData
     * @returns {!Array.<!number>}
     * @private
     */
    static _extractColumnSurvivalRateStatsFromPixelDatas(normsPixelData) {
        let curSurvivalRate = 1;
        let survivalRates = [];
        for (let col = 0; col < normsPixelData.length; col++) {
            if (normsPixelData[col].length > 0) {
                curSurvivalRate = normsPixelData[col][0];
            }
            survivalRates.push(curSurvivalRate);
        }
        return survivalRates;
    }

    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @param {!number} time
     * @returns {!CircuitStats}
     */
    static _fromCircuitAtTime_noFallback(circuitDefinition, time) {
        circuitDefinition = circuitDefinition.withMinimumWireCount();
        const numWires = circuitDefinition.numWires;

        // Advance state while collecting stats into textures.
        let stateTrader = new WglTextureTrader(CircuitShaders.classicalState(0).toVec2Texture(numWires));
        let controlTex = CircuitShaders.controlMask(Controls.NONE).toBoolTexture(numWires);
        let {colQubitDensities, colNorms, customStats, customStatsMap} = advanceStateWithCircuit(
            new CircuitEvalContext(
                time,
                0,
                numWires,
                Controls.NONE,
                controlTex,
                Controls.NONE,
                stateTrader,
                new Map()),
            circuitDefinition,
            true);
        controlTex.deallocByDepositingInPool("controlTex in _fromCircuitAtTime_noFallback");
        if (currentShaderCoder().vec2.needRearrangingToBeInVec4Format) {
            stateTrader.shadeHalveAndTrade(Shaders.packVec2IntoVec4);
        }

        // Read all texture data.
        let pixelData = Util.objectifyArrayFunc(KetTextureUtil.mergedReadFloats)({
            output: stateTrader.currentTexture,
            colQubitDensities,
            colNorms,
            customStats});

        // -- INTERPRET --
        let qubitDensities =
            CircuitStats._extractColumnQubitStatsFromPixelDatas(circuitDefinition, pixelData.colQubitDensities);
        let survivalRates =
            CircuitStats._extractColumnSurvivalRateStatsFromPixelDatas(pixelData.colNorms);
        let outputSuperposition = KetTextureUtil.pixelsToAmplitudes(
            pixelData.output,
            survivalRates.length === 0 ? 1 : survivalRates[survivalRates.length - 1]);

        let customStatsProcessed = new Map();
        for (let {col, row, out} of customStatsMap) {
            //noinspection JSUnusedAssignment
            let func = circuitDefinition.gateInSlot(col, row).customStatPostProcesser || (e => e);
            //noinspection JSUnusedAssignment
            customStatsProcessed.set(col+":"+row, func(pixelData.customStats[out], circuitDefinition, col, row));
        }

        return new CircuitStats(
            circuitDefinition,
            time,
            survivalRates,
            qubitDensities,
            outputSuperposition,
            customStatsProcessed);
    }
}

/**
 * Simulates a circuit whose QND record bits are classical (see QndRecordSim): runs plan.qdef, reading each
 * readout back from the scratch qubit, then reports the stats on the original circuit's wires.
 * @param {!CircuitDefinition} circuitDefinition
 * @param {!number} time
 * @param {!Object} plan From recordPlan.
 * @returns {!CircuitStats}
 */
CircuitStats._fromCircuitWithRecord = (circuitDefinition, time, plan) => {
    let qdef = plan.qdef;
    const numWires = qdef.numWires;
    let bits = new Map();
    let outcomes = new Map();
    let hooks = {
        skipColumn: col => plan.conds.has(col) && !condHolds(plan.conds.get(col), bits),
        afterColumn: (col, ctx) => {
            let row = plan.reads.get(col);
            if (row === undefined) {
                return;
            }
            // The readout left the scratch qubit in |s⟩: read s back, then return the scratch qubit to |0⟩.
            let tex = KetTextureUtil.superpositionToQubitDensities(
                ctx.stateTrader.currentTexture, Controls.NONE, 1 << plan.scratch);
            let m = KetTextureUtil.pixelsToQubitDensityMatrices(KetTextureUtil.mergedReadFloats([tex])[0])[0];
            let buf = m.rawBuffer();
            let s = buf[6] > 0.5 * (buf[0] + buf[6]) ? 1 : 0;
            bits.set(row, s);
            outcomes.set(col + ":" + row, s === 1);
            if (s === 1) {
                let noControls = CircuitShaders.controlMask(Controls.NONE).toBoolTexture(numWires);
                GateShaders.applyMatrixOperation(new CircuitEvalContext(
                    time, plan.scratch, numWires, Controls.NONE, noControls, Controls.NONE, ctx.stateTrader,
                    new Map()), Matrix.PAULI_X);
                noControls.deallocByDepositingInPool("noControls in _fromCircuitWithRecord");
            }
        }
    };

    let stateTrader = new WglTextureTrader(CircuitShaders.classicalState(0).toVec2Texture(numWires));
    let controlTex = CircuitShaders.controlMask(Controls.NONE).toBoolTexture(numWires);
    let {colQubitDensities, colNorms, customStats, customStatsMap} = advanceStateWithCircuit(
        new CircuitEvalContext(time, 0, numWires, Controls.NONE, controlTex, Controls.NONE, stateTrader, new Map()),
        qdef,
        true,
        hooks);
    controlTex.deallocByDepositingInPool("controlTex in _fromCircuitWithRecord");
    if (currentShaderCoder().vec2.needRearrangingToBeInVec4Format) {
        stateTrader.shadeHalveAndTrade(Shaders.packVec2IntoVec4);
    }
    let pixelData = Util.objectifyArrayFunc(KetTextureUtil.mergedReadFloats)({
        output: stateTrader.currentTexture,
        colQubitDensities,
        colNorms,
        customStats});

    let survivalRates = CircuitStats._extractColumnSurvivalRateStatsFromPixelDatas(pixelData.colNorms);
    let unity = survivalRates.length === 0 ? 1 : survivalRates[survivalRates.length - 1];
    // The scratch qubit (the top bit) ends in |0⟩: keep the qubits' half of the state.
    let amps = KetTextureUtil.pixelsToAmplitudes(pixelData.output, unity).rawBuffer();
    let finalState = new Matrix(1, 1 << plan.scratch, amps.slice(0, 2 << plan.scratch));

    let nan = Matrix.zero(2, 2).times(NaN);
    let qubitDensities = CircuitStats._extractColumnQubitStatsFromPixelDatas(qdef, pixelData.colQubitDensities).
        map(col => {
            let out = new Array(circuitDefinition.numWires).fill(nan);
            plan.qubitRows.forEach((row, k) => out[row] = col[k]);
            return out;
        });

    let customStatsProcessed = new Map();
    for (let {col, row, out} of customStatsMap) {
        let func = qdef.gateInSlot(col, row).customStatPostProcesser || (e => e);
        let origRow = row === plan.scratch ? plan.reads.get(col) : plan.qubitRows[row];
        customStatsProcessed.set(col + ":" + origRow, func(pixelData.customStats[out], qdef, col, row));
    }
    for (let [key, s] of outcomes.entries()) {
        customStatsProcessed.set(key, s);
    }

    return new CircuitStats(
        circuitDefinition, time, survivalRates, qubitDensities, finalState, customStatsProcessed, plan.qubitRows);
};

/**
 * @param {!Matrix} matrix
 */
function singleQubitDensityMatrixToReadableJson(matrix) {
    if (matrix.hasNaN()) {
        return null;
    }
    let [x, y, z] = matrix.qubitDensityMatrixToBlochVector();
    x *= -1;
    z *= -1;
    return {x, y, z};
}

CircuitStats.EMPTY = CircuitStats.withNanDataFromCircuitAtTime(CircuitDefinition.EMPTY, 0);

export {CircuitStats}
