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

import {GateBuilder} from "../circuit/Gate.js"
import {GateShaders} from "../circuit/GateShaders.js"
import {Matrix} from "../math/Matrix.js"
import {Config} from "../Config.js"
import {GatePainting} from "../draw/GatePainting.js"
import {sampleMeasure, detectorStatTexture, withClearedControls, drawClick} from "./Detector.js"

const RESET_TO_ZERO = Matrix.square(1, 1, 0, 0);
const RESET_TO_PLUS = Matrix.square(Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2);

/**
 * Measures the qubit (collapsing it) and then maps it onto a fixed state.
 * @param {!Matrix} matrix
 * @returns {!function(!CircuitEvalContext)}
 */
function measureThenApply(matrix) {
    return withClearedControls(ctx => {
        sampleMeasure(ctx);
        GateShaders.applyMatrixOperation(ctx, matrix);
    });
}

/**
 * @param {!GateDrawParams} args
 * @param {!string} label
 */
function drawReset(args, label) {
    GatePainting.paintBackground(args);
    GatePainting.paintOutline(args);
    args.painter.printLine(label, args.rect, 0.5, undefined, 16, undefined, 0.5);
    args.painter.printLine('reset', args.rect.skipTop(args.rect.h - 11), 0.5, '#666', 9, undefined, 0);
}

let QndGates = {};

QndGates.ParityReadout = new GateBuilder().
    setSerializedIdAndSymbol('QNDread').
    setTitle('QND Parity Readout').
    setBlurb("Quantum non-demolition measurement of the column's parity controls.\n" +
        'Put Z-parity (or X-parity) controls on the measured qubits in the same column.\n' +
        'The sampled outcome s is written to this wire as |s⟩ (shows *click* when s=1); ' +
        'use it as a control for corrections later.\n' +
        'Data qubits are only used as controls, so Z errors stay Z errors (bias-preserving).').
    setDrawer(args => {
        let rect = args.rect;
        GatePainting.paintBackground(args, '#e3f4ee', '#e3f4ee');
        args.painter.trace(trace => GatePainting.traceRoundRect(trace.ctx, rect.paddedBy(-0.5))).
            thenStroke('#0f8a6c', 1.8);

        // Meter glyph.
        let c = rect.center();
        let r = Math.min(rect.w, rect.h) * 0.3;
        args.painter.trace(trace => {
            trace.ctx.arc(c.x, c.y + r * 0.45, r, Math.PI, 2 * Math.PI);
        }).thenStroke(Config.FOREGROUND_COLOR, 1.5);
        args.painter.strokeLine(c.offsetBy(0, r * 0.45), c.offsetBy(r * 0.6, -r * 0.55));
        args.painter.printLine('QND', rect, 0.5, '#0f8a6c', 9, undefined, 0);
        drawClick(args, undefined);
    }).
    markAsReachingOtherWires().
    setActualEffectToUpdateFunc(ctx => {
        // Reset the ancilla, flip it conditioned on the parity controls, then read it out.
        measureThenApply(RESET_TO_ZERO)(ctx);
        GateShaders.applyMatrixOperation(ctx, Matrix.PAULI_X);
        withClearedControls(sampleMeasure)(ctx);
    }).
    setStatTexturesMaker(withClearedControls(detectorStatTexture)).
    setStatPixelDataPostProcessor(pixels => pixels[0] > 0).
    gate.withParam('');

QndGates.ResetPlus = new GateBuilder().
    setSerializedIdAndSymbol('reset+').
    setTitle('Reset to |+⟩').
    setBlurb('Discards the qubit and re-prepares it in |+⟩ (P|+⟩ in the papers).\n' +
        'Used to recycle ancillas between rounds.').
    setDrawer(args => drawReset(args, '|+⟩')).
    markAsReachingOtherWires().
    setActualEffectToUpdateFunc(measureThenApply(RESET_TO_PLUS)).
    gate;

QndGates.ResetZero = new GateBuilder().
    setSerializedIdAndSymbol('reset0').
    setTitle('Reset to |0⟩').
    setBlurb('Discards the qubit and re-prepares it in |0⟩.').
    setDrawer(args => drawReset(args, '|0⟩')).
    markAsReachingOtherWires().
    setActualEffectToUpdateFunc(measureThenApply(RESET_TO_ZERO)).
    gate;

QndGates.all = [
    QndGates.ParityReadout,
    QndGates.ResetPlus,
    QndGates.ResetZero,
];

export {QndGates}
