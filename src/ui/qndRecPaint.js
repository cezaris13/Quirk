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

import {Config} from "../Config.js"
import {GatePainting} from "../draw/GatePainting.js"
import {Rect} from "../math/Rect.js"

/**
 * Painting helpers for classical-record expressions like c₀⊕c₃ (used by the "classical record" view).
 */

const LABEL_FONT = Config.DEFAULT_FONT_FAMILY;

/**
 * Width of a record expression c_{i}⊕c_{j}⊕... (or a bare "c" when the indices are undefined).
 * @param {!CanvasRenderingContext2D} ctx
 * @param {undefined|!Array.<!int>} indices
 * @param {!number} size
 * @param {!string=} joiner
 * @returns {!number}
 */
function measureRecExpr(ctx, indices, size, joiner = "⊕") {
    if (indices === undefined) {
        ctx.font = `italic ${size}px ${Config.MATH_FONT_FAMILY}`;
        return ctx.measureText("c").width;
    }
    let w = 0;
    indices.forEach((k, i) => {
        ctx.font = `italic ${size}px ${Config.MATH_FONT_FAMILY}`;
        w += ctx.measureText("c").width;
        ctx.font = `${Math.round(size * 0.72)}px ${Config.MATH_FONT_FAMILY}`;
        w += ctx.measureText(String(k)).width + 1;
        if (i < indices.length - 1) {
            ctx.font = `${size}px ${Config.MATH_FONT_FAMILY}`;
            w += ctx.measureText(joiner).width + 2;
        }
    });
    return w;
}

/**
 * Draws a record expression starting at (x, y) and returns the x coordinate where it ends.
 * @param {!CanvasRenderingContext2D} ctx
 * @param {undefined|!Array.<!int>} indices
 * @param {!number} x
 * @param {!number} y
 * @param {!number} size
 * @param {!string=} joiner
 * @returns {!number}
 */
function fillRecExpr(ctx, indices, x, y, size, joiner = "⊕") {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (indices === undefined) {
        ctx.font = `italic ${size}px ${Config.MATH_FONT_FAMILY}`;
        ctx.fillText("c", x, y);
        return x + ctx.measureText("c").width;
    }
    indices.forEach((k, i) => {
        ctx.font = `italic ${size}px ${Config.MATH_FONT_FAMILY}`;
        ctx.fillText("c", x, y);
        x += ctx.measureText("c").width;
        ctx.font = `${Math.round(size * 0.72)}px ${Config.MATH_FONT_FAMILY}`;
        ctx.fillText(String(k), x + 0.5, y + size * 0.28);
        x += ctx.measureText(String(k)).width + 1;
        if (i < indices.length - 1) {
            ctx.font = `${size}px ${Config.MATH_FONT_FAMILY}`;
            ctx.fillText(joiner, x + 1, y);
            x += ctx.measureText(joiner).width + 2;
        }
    });
    return x;
}

/**
 * Paints a classically-controlled gate box like X^{c₀⊕c₁}, shrinking the text until it fits.
 * @param {!CanvasRenderingContext2D} ctx
 * @param {!Rect} rect
 * @param {!string} label
 * @param {undefined|!Array.<!int>} indices
 * @param {!{shadow: (undefined|!boolean), highlighted: (undefined|!boolean), bad: (undefined|!boolean), joiner: (undefined|!string)}=} opts
 */
function paintClassicalGate(ctx, rect, label, indices, opts = {}) {
    ctx.save();
    ctx.beginPath();
    GatePainting.traceRoundRect(ctx, rect);
    if (opts.shadow && !opts.highlighted) {
        ctx.shadowColor = Config.TOOLBOX_GATE_SHADOW_COLOR;
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
    }
    ctx.fillStyle = opts.highlighted ? Config.HIGHLIGHTED_GATE_FILL_COLOR : Config.GATE_FILL_COLOR;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    let inner = new Rect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.beginPath();
    GatePainting.traceRoundRect(ctx, inner);
    if (opts.bad) {
        ctx.setLineDash([3, 2]);
    }
    ctx.strokeStyle = opts.bad ? Config.RECORD_BAD_COLOR : opts.highlighted ? Config.GATE_HIGHLIGHT_OUTLINE_COLOR : Config.GATE_OUTLINE_COLOR;
    ctx.lineWidth = opts.highlighted || opts.bad ? 1.6 : 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    let size = 16;
    let sub = 12;
    let joiner = opts.joiner || "⊕";
    while (true) {
        ctx.font = `${size}px ${LABEL_FONT}`;
        let labelWidth = ctx.measureText(label).width;
        let exprWidth = measureRecExpr(ctx, indices, sub, joiner);
        if (labelWidth + exprWidth + 6 <= rect.w || sub <= 7) {
            let x = rect.center().x - (labelWidth + exprWidth + 1) / 2;
            let y = rect.center().y + size * 0.36;
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = Config.DEFAULT_TEXT_COLOR;
            ctx.font = `${size}px ${LABEL_FONT}`;
            ctx.fillText(label, x, y);
            ctx.fillStyle = opts.bad ? Config.RECORD_BAD_COLOR : Config.RECORD_COLOR;
            fillRecExpr(ctx, indices, x + labelWidth + 1, y - size * 0.5, sub, joiner);
            break;
        }
        --size;
        --sub;
    }
    ctx.restore();
}

export {measureRecExpr, fillRecExpr, paintClassicalGate}
