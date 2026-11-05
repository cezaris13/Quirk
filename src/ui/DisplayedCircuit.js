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

import {CachablePainting} from "../draw/CachablePainting.js"
import {CircuitDefinition} from "../circuit/CircuitDefinition.js"
import {CircuitStats} from "../circuit/CircuitStats.js"
import {Config} from "../Config.js"
import {QndView, qndCheckInColumn, computeRecord, parseRecArg} from "./qndView.js"
import {measureRecExpr, fillRecExpr, paintClassicalGate} from "./qndRecPaint.js"
import {DetailedError} from "../base/DetailedError.js"
import {equate} from "../base/Equate.js"
import {Format} from "../base/Format.js"
import {GateColumn} from "../circuit/GateColumn.js"
import {GateDrawParams} from "../draw/GateDrawParams.js"
import {GatePainting} from "../draw/GatePainting.js"
import {Hand} from "../ui/Hand.js"
import {MathPainter} from "../draw/MathPainter.js"
import {Point} from "../math/Point.js"
import {Matrix} from "../math/Matrix.js"
import {Rect} from "../math/Rect.js"
import {Util} from "../base/Util.js"
import {seq, Seq} from "../base/Seq.js"
import {paintBlochSphereDisplay} from "../gates/BlochSphereDisplay.js"

/** @type {!number} */
let CIRCUIT_OP_HORIZONTAL_SPACING = 10;
/** @type {!number} */
let CIRCUIT_OP_LEFT_SPACING = 35;

const SUPERPOSITION_GRID_LABEL_SPAN = 50;

const EXTRA_COLS_FOR_SINGLE_QUBIT_DISPLAYS = 2;

class DisplayedCircuit {
    /**
     *
     * @param {!number} top
     * @param {!CircuitDefinition} circuitDefinition
     * @param {undefined|!int} compressedColumnIndex
     * @param {undefined|!{col: !int, row: undefined|!int, resizeStyle: !boolean}} highlightedSlot
     * @param {undefined|!int} extraWireStartIndex
     * @param {undefined|!int} spareAt See _spareRecordStart.
     * @private
     */
    constructor(top, circuitDefinition, compressedColumnIndex, highlightedSlot, extraWireStartIndex, spareAt) {
        if (!Number.isFinite(top)) {
            throw new DetailedError("Bad top", {top, circuitDefinition});
        }
        if (!(circuitDefinition instanceof CircuitDefinition)) {
            throw new DetailedError("Bad circuitDefinition", {top, circuitDefinition});
        }
        /**
         * @type {!number}
         */
        this.top = top;
        /**
         * @type {!CircuitDefinition}
         */
        this.circuitDefinition = circuitDefinition;
        /**
         * @type {undefined|!int}
         * @private
         */
        this._compressedColumnIndex = compressedColumnIndex;
        /**
         * @type {undefined|!{col: !int, row: undefined|!int, resizeStyle: !boolean}}
         * @private
         */
        this._highlightedSlot = highlightedSlot;
        /**
         * @type {undefined|!int}
         * @private
         */
        this._extraWireStartIndex = extraWireStartIndex;
        /**
         * @type {undefined|!int}
         * @private
         */
        this._spareAt = extraWireStartIndex === undefined ? undefined : spareAt;
    }

    /**
     * @param {!number} top
     * @returns {!DisplayedCircuit}
     */
    static empty(top) {
        return new DisplayedCircuit(
            top,
            new CircuitDefinition(Config.MIN_WIRE_COUNT, []),
            undefined,
            undefined,
            undefined);
    }

    /**
     * @returns {!boolean}
     */
    isBeingEdited() {
        return this._extraWireStartIndex !== undefined;
    }

    /**
     * The number of wires that were in the circuit before picking up a gate, or the number that will be in the circuit
     * after dropping a gate; whichever is larger.
     * @returns {!int}
     * @private
     */
    _groundedWireCount() {
        let pseudoCount =
            this._extraWireStartIndex !== undefined && this._extraWireStartIndex !== Config.MAX_ROW_COUNT ? 1 : 0;

        let n = Math.max(Config.MIN_WIRE_COUNT, this.circuitDefinition.numWires) - pseudoCount;
        return Math.max(n, this.circuitDefinition.minimumRequiredWireCount());
    }

    /**
     * @param {!boolean=true} forTooltip
     * @returns {!number}
     */
    desiredHeight(forTooltip=false) {
        if (forTooltip) {
            return this.circuitDefinition.numWires * Config.WIRE_SPACING;
        }
        return this._groundedWireCount() * Config.WIRE_SPACING + 55;
    }

    /**
     * @param {!boolean=true} forTooltip
     * @returns {!number}
     */
    desiredWidth(forTooltip=false) {
        if (forTooltip) {
            let squish = this._squish();
            let lastSlot = squish === undefined ? this.circuitDefinition.columns.length - 1 : squish.count - 1;
            return this.opRect(this._colOfSlot(lastSlot)).right() + CIRCUIT_OP_LEFT_SPACING;
        }
        return this._rectForSuperpositionDisplay().right() + 101;
    }

    /**
     * @param {!int} wireIndex
     * @returns {!Rect}
     */
    wireRect(wireIndex) {
        if (wireIndex < 0) {
            throw new DetailedError("Bad wireIndex", {wireIndex});
        }
        let b = this._spareRecordStart();
        let s = this._extraWireStartIndex;
        let shown = b === undefined ? wireIndex : wireIndex === s ? b : wireIndex >= b && wireIndex < s ? wireIndex + 1 :
            wireIndex;
        return new Rect(0, this.top + Config.WIRE_SPACING * shown, Infinity, Config.WIRE_SPACING);
    }

    /**
     * @param {!number} y
     * @returns {!int}
     */
    wireIndexAt(y) {
        let shown = Math.floor((y - this.top) / Config.WIRE_SPACING);
        let b = this._spareRecordStart();
        let s = this._extraWireStartIndex;
        return b === undefined ? shown : shown === b ? s : shown > b && shown <= s ? shown - 1 : shown;
    }

    /**
     * While a one-wire gate is held over a circuit that ends with QND record wires, two spare wires are added: the
     * first (a new qubit) is drawn just above the record wires, the second (a new record wire) below them. The layout
     * is fixed when the gate is picked up, so the wires don't jump while it's moved around, and applied on drop.
     * @returns {undefined|!int} The row where the record wires start, when the spare wires are in that layout.
     * @private
     */
    _spareRecordStart() {
        return this._spareAt;
    }

    //noinspection JSMethodCanBeStatic
    /**
     * @param {!number} x
     * @returns {!number} The continuous column-space coordinate corresponding to the given display-space coordinate.
     * @private
     */
    toColumnSpaceCoordinate(x) {
        let spacing = (CIRCUIT_OP_HORIZONTAL_SPACING + Config.GATE_RADIUS * 2);
        let left = CIRCUIT_OP_LEFT_SPACING - CIRCUIT_OP_HORIZONTAL_SPACING / 2;
        return (x - left) / spacing - 0.5;
    }

    /**
     * @param {!number} y
     * @returns {undefined|!int}
     */
    indexOfDisplayedRowAt(y) {
        let i = this.wireIndexAt(y);
        if (i < 0 || i >= this.circuitDefinition.numWires) {
            return undefined;
        }
        return i;
    }

    /**
     * @param {!number} x
     * @param {undefined|!number} y Used to pick between columns that share a squished display slot.
     * @returns {undefined|!int}
     */
    indexOfDisplayedColumnAt(x, y=undefined) {
        let col = this.toColumnSpaceCoordinate(x);
        let squish = this._squish();
        let compressedSlot = this._compressedColumnIndex === undefined ?
            undefined :
            this._slotOf(this._compressedColumnIndex);
        let i;
        if (compressedSlot === undefined || col < compressedSlot - 0.75) {
            i = Math.round(col);
        } else if (col < compressedSlot - 0.25) {
            i = compressedSlot;
        } else {
            i = Math.round(col) - 1;
        }
        if (squish !== undefined) {
            i = this._colOfSlot(i, y === undefined ? undefined : this.indexOfDisplayedRowAt(y));
        }

        if (i < 0 || i >= this.circuitDefinition.columns.length) {
            return undefined;
        }

        return i;
    }

    /**
     * In classical record view, packs columns that touch disjoint wires into shared display slots.
     * @returns {undefined|!{slot: !Array.<!int>, cols: !Array.<!Array.<!int>>, count: !int}}
     * @private
     */
    _squish() {
        if (!QndView.record || QndView.dragging) {
            return undefined;
        }
        let def = this.circuitDefinition;
        if (QndView.frozen !== undefined && QndView.frozen.n === def.columns.length) {
            return QndView.frozen.info;
        }
        let key = QndView.layoutKey();
        if (this._squishCache !== undefined && this._squishCache.def === def && this._squishCache.key === key) {
            return this._squishCache.info;
        }

        let rec = this._record();
        let slot = [];
        let cols = [];
        let infos = [];
        // Columns can't move before a slot holding a column they don't fit beside (wide gates, empty columns).
        let barrier = 0;
        def.columns.forEach((column, c) => {
            // Merged into an earlier correction's gate: shares its slot and takes no space of its own.
            if (rec.mergedInto.has(c)) {
                let head = rec.mergedInto.get(c);
                infos.push(infos[head]);
                cols[slot[head]].push(c);
                slot.push(slot[head]);
                return;
            }
            let spans = [];
            let writes = new Set();
            let reads = new Set();
            let narrow = true;
            let any = false;
            let cond = rec.cond.get(c);
            column.gates.forEach((gate, row) => {
                if (gate === undefined) {
                    return;
                }
                any = true;
                if (gate.width !== 1) {
                    narrow = false;
                }
                if (gate.isControl()) {
                    reads.add(row);
                } else {
                    for (let k = 0; k < gate.height; k++) {
                        writes.add(row + k);
                    }
                }
            });
            let hidden = this._hiddenReadout(c);

            // In the record view the bit wires are drawn as record entries c_k, so a hidden readout writes its
            // entry and a correction reads its entries. Track those instead of the shared bit wire, otherwise
            // every readout and correction would conflict through it.
            let recWrites = new Set();
            let recReads = new Set();
            if (hidden !== undefined) {
                writes.delete(hidden.readRow);
                recWrites.add(rec.readName.get(c + ':' + hidden.readRow));
            }
            if (cond !== undefined) {
                for (let q of cond.ctlRows) {
                    reads.delete(q);
                }
                for (let k of cond.keys) {
                    recReads.add(k);
                }
            }

            if (cond !== undefined) {
                spans = cond.targets.map(r => [r, r]);
            } else if (hidden !== undefined) {
                spans = [[Math.min(...hidden.rows), Math.max(...hidden.rows)]];
            } else if (any) {
                let rows = [];
                column.gates.forEach((gate, row) => {
                    if (gate !== undefined) {
                        rows.push(row, row + gate.height - 1);
                    }
                });
                spans = [[Math.min(...rows), Math.max(...rows)]];
            }

            let info = {spans, W: writes, R: reads, RW: recWrites, RR: recReads, ok: narrow && any};
            let conflicts = other =>
                other.spans.some(a => info.spans.some(b => a[0] <= b[1] && b[0] <= a[1])) ||
                [...info.W].some(r => other.W.has(r) || other.R.has(r)) ||
                [...info.R].some(r => other.W.has(r)) ||
                [...info.RR].some(k => other.RW.has(k));

            // Place the column in the earliest slot after everything it depends on (as soon as possible),
            // so e.g. a correction sits right after the readout it uses even if later columns came between.
            let s;
            if (info.ok) {
                s = barrier;
                infos.forEach((other, a) => {
                    if (conflicts(other)) {
                        s = Math.max(s, slot[a] + 1);
                    }
                });
            } else {
                s = cols.length;
                barrier = s + 1;
            }
            if (s === cols.length) {
                cols.push([]);
            }
            infos.push(info);
            cols[s].push(c);
            slot.push(s);
        });

        // Wires each column covers, so per-wire drawing can follow the display order of the columns on it.
        let spans = infos.map(info => info.spans);
        let info = {slot, cols, count: cols.length, spans};
        this._squishCache = {def, key, info};
        return info;
    }

    /**
     * @returns {undefined|!function(col: !int, row: !int) : !boolean} Whether a wire has been consumed by a
     *     single-qubit compact QND readout (and not yet reused) at a column.
     * @private
     */
    _qndMeasuredWires() {
        let def = this.circuitDefinition;
        let key = QndView.layoutKey();
        if (this._goneCache !== undefined && this._goneCache.def === def && this._goneCache.key === key) {
            return this._goneCache.fn;
        }

        let n = def.columns.length;
        let gone = new Array(def.numWires).fill(false);
        let history = [];
        for (let row = 0; row < def.numWires; row++) {
            history.push([false]);
        }
        let anyGone = false;
        for (let c = 0; c < n; c++) {
            let column = def.columns[c];
            let check = QndView.isCompact(c) ? qndCheckInColumn(column) : undefined;
            for (let row = 0; row < def.numWires; row++) {
                if (column.gates[row] !== undefined) {
                    gone[row] = false;
                }
            }
            if (check !== undefined && check.rows.length === 1) {
                anyGone = gone[check.rows[0]] = true;
            }
            for (let row = 0; row < def.numWires; row++) {
                history[row].push(gone[row]);
            }
        }

        let fn = anyGone ? (col, row) => row < history.length && history[row][Math.min(col, n)] : undefined;
        this._goneCache = {def, key, fn};
        return fn;
    }

    /**
     * @param {!int} row
     * @returns {!function(slot: !int) : !int} For each display slot, the column whose "state before" applies to
     *     the wire there: the first column on the wire at or after the slot. Packed record-view slots aren't in
     *     column order, but the columns on any one wire are.
     * @private
     */
    _wireStateColumns(row) {
        let squish = this._squish();
        let n = this.circuitDefinition.columns.length;
        if (squish === undefined) {
            return slot => slot;
        }
        let onWire = [];
        for (let c = 0; c < n; c++) {
            if (squish.spans[c].some(([a, b]) => a <= row && row <= b)) {
                onWire.push(c);
            }
        }
        return slot => {
            if (slot >= squish.count) {
                return n + (slot - squish.count);
            }
            let next = onWire.find(c => squish.slot[c] >= slot);
            return next === undefined ? n : next;
        };
    }

    /**
     * @param {!int} col
     * @returns {!int} The display slot the column is drawn in.
     * @private
     */
    _slotOf(col) {
        let squish = this._squish();
        if (squish === undefined) {
            return col;
        }
        let n = this.circuitDefinition.columns.length;
        return col < 0 ? col : col < n ? squish.slot[col] : squish.count + (col - n);
    }

    /**
     * @param {!int} slot
     * @param {undefined|!int} row
     * @returns {!int} The column shown in the display slot, preferring the one that has something at the row.
     * @private
     */
    _colOfSlot(slot, row=undefined) {
        let squish = this._squish();
        if (squish === undefined || slot < 0) {
            return slot;
        }
        if (slot >= squish.count) {
            return this.circuitDefinition.columns.length + (slot - squish.count);
        }
        let members = squish.cols[slot];
        if (row !== undefined) {
            for (let c of members) {
                let found = this.circuitDefinition.findGateCoveringSlot(c, row);
                if (found !== undefined && found.col === c) {
                    return c;
                }
            }
            for (let c of members) {
                let check = QndView.isCompact(c) ? qndCheckInColumn(this.circuitDefinition.columns[c]) : undefined;
                if (check !== undefined && row >= Math.min(...check.rows) && row <= Math.max(...check.rows)) {
                    return c;
                }
            }
            for (let c of members) {
                let gates = this.circuitDefinition.columns[c].gates;
                if (gates[row] === undefined && !gates.some(g => g !== undefined && g.isControl())) {
                    return c;
                }
            }
        }
        return members[0];
    }

    /**
     * @param {!int} col
     * @returns {!int} How many columns share the column's display slot.
     * @private
     */
    _slotSize(col) {
        let squish = this._squish();
        return squish === undefined || col >= squish.slot.length ? 1 : squish.cols[squish.slot[col]].length;
    }

    /**
     * @param {!Point} p
     * @returns {undefined|!number}
     */
    findOpHalfColumnAt(p) {
        if (p.x < 0 || p.y < this.top || p.y > this.top + this.desiredHeight()) {
            return undefined;
        }

        let halfSlot = Math.max(-0.5, Math.round(this.toColumnSpaceCoordinate(p.x) * 2) / 2);
        let squish = this._squish();
        if (squish === undefined || halfSlot < 0) {
            return halfSlot;
        }
        if (halfSlot % 1 === 0) {
            return this._colOfSlot(halfSlot, this.indexOfDisplayedRowAt(p.y));
        }
        let slot = Math.floor(halfSlot);
        if (slot >= squish.count) {
            return this._colOfSlot(slot) + 0.5;
        }
        let members = squish.cols[slot];
        return members[members.length - 1] + 0.5;
    }

    /**
     * @param {!Hand} hand
     * @returns {undefined|!{col: !int, row: !int, halfColIndex: !number}}
     * @private
     */
    _findModificationIndex_helperColRow(hand) {
        if (hand.pos === undefined || hand.heldGate === undefined) {
            return undefined;
        }
        let pos = hand.pos.minus(hand.holdOffset).plus(new Point(Config.GATE_RADIUS, Config.GATE_RADIUS));
        let halfColIndex = this.findOpHalfColumnAt(pos);
        let row = this.indexOfDisplayedRowAt(pos.y);
        if (halfColIndex === undefined || row === undefined) {
            return undefined;
        }
        let col = Math.ceil(halfColIndex);
        return {col, row, halfColIndex};
    }

    /**
     * @param {!Hand} hand
     * @returns {?{ col : !number, row : !number, isInsert : !boolean }}
     */
    findModificationIndex(hand) {
        let loc = this._findModificationIndex_helperColRow(hand);
        if (loc === undefined) {
            return undefined;
        }
        let {col, row, halfColIndex} = loc;

        let isInsert = Math.abs(halfColIndex % 1) === 0.5;
        if (col >= this.circuitDefinition.columns.length) {
            return {col: col, row: row, isInsert: isInsert};
        }

        if (!isInsert) {
            let mustInsert = this.circuitDefinition.isSlotRectCoveredByGateInSameColumn(
                col, row, hand.heldGate.height);
            if (mustInsert) {
                let isAfter = hand.pos.x > this.opRect(col).center().x;
                isInsert = true;
                if (isAfter) {
                    col += 1;
                }
            }
        }

        return {col: col, row: row, isInsert: isInsert};
    }

    /**
     * @param {!int} operationIndex
     * @returns {Rect!}
     */
    opRect(operationIndex) {
        let opWidth = Config.GATE_RADIUS * 2;
        let opSeparation = opWidth + CIRCUIT_OP_HORIZONTAL_SPACING;
        let tweak = 0;
        let compressedSlot = this._compressedColumnIndex === undefined ?
            undefined :
            this._slotOf(this._compressedColumnIndex);
        let col = operationIndex;
        operationIndex = this._slotOf(operationIndex);
        if (compressedSlot !== undefined && operationIndex === compressedSlot) {
            tweak = opSeparation / 2;
        }
        if (compressedSlot !== undefined && operationIndex > compressedSlot) {
            tweak = opSeparation;
        }

        let dx = opSeparation * operationIndex - tweak + CIRCUIT_OP_LEFT_SPACING;
        let anim = QndView.anim;
        if (anim !== undefined && anim.n === this.circuitDefinition.columns.length && col >= 0 && col < anim.fromX.length) {
            let t = QndView.animProgress();
            dx = anim.fromX[col] + (dx - anim.fromX[col]) * t;
        }
        return new Rect(dx, this.top, opWidth, this.desiredHeight());
    }

    /**
     * @param {!int} wireIndex
     * @param {!int} operationIndex
     * @param {!int=} width
     * @param {!int=} height
     */
    gateRect(wireIndex, operationIndex, width=1, height=1) {
        let op = this.opRect(operationIndex);
        let wire = this.wireRect(wireIndex);
        let r = new Rect(
            op.center().x - Config.GATE_RADIUS,
            wire.center().y - Config.GATE_RADIUS,
            2*Config.GATE_RADIUS + (width-1)*Config.WIRE_SPACING,
            2*Config.GATE_RADIUS + (height-1)*Config.WIRE_SPACING);

        return new Rect(Math.round(r.x - 0.5) + 0.5, Math.round(r.y - 0.5) + 0.5, Math.round(r.w), Math.round(r.h));
    }

    /**
     * @returns {!DisplayedCircuit}
     */
    afterTidyingUp() {
        let def = this._spareAt === undefined ? this.circuitDefinition : this._defInDrawnOrder();
        return this.
            withCircuit(def.
                withUncoveredColumnsRemoved().
                withHeightOverlapsFixed().
                withWidthOverlapsFixed().
                withUncoveredColumnsRemoved().
                withTrailingSpacersIncluded()).
            _withCompressedColumnIndex(undefined).
            _withExtraWireStartIndex(undefined).
            _withHighlightedSlot(undefined);
    }

    /**
     * @param {!DisplayedCircuit|*} other
     * @returns {!boolean}
     */
    isEqualTo(other) {
        if (this === other) {
            return true;
        }
        return other instanceof DisplayedCircuit &&
            this.top === other.top &&
            this.circuitDefinition.isEqualTo(other.circuitDefinition) &&
            this._compressedColumnIndex === other._compressedColumnIndex &&
            this._extraWireStartIndex === other._extraWireStartIndex &&
            equate(this._highlightedSlot, other._highlightedSlot);
    }

    /**
     * @param {!Painter} painter
     * @param {!Hand} hand
     * @param {!CircuitStats} stats
     * @param {!boolean=false} forTooltip
     * @param {!boolean} showWires
     */
    paint(painter, hand, stats, forTooltip=false, showWires=true) {
        if (showWires) {
            this._drawWires(painter, !forTooltip, hand);
            this._drawClassicalRows(painter);
        }

        for (let col = 0; col < this.circuitDefinition.columns.length; col++) {
            this._drawColumn(painter, this.circuitDefinition.columns[col], col, hand, stats);
        }

        this._drawRecordLabels(painter);
        if (!forTooltip) {
            this._drawOutputDisplays(painter, stats, hand);
            this._drawHintLabels(painter, stats);
        }

        this._drawRowDragHighlight(painter);
    }

    /**
     * @param {!Painter} painter
     * @param {!boolean} showLabels
     * @param {!Hand} hand
     * @private
     */
    _drawWires(painter, showLabels, hand) {
        let drawnWireCount = this._spareRecordStart() !== undefined ? this.circuitDefinition.numWires :
            Math.min(this.circuitDefinition.numWires, (this._extraWireStartIndex || Infinity) + 1);

        // Initial value labels
        if (showLabels) {
            for (let row = 0; row < drawnWireCount; row++) {
                let wireRect = this.wireRect(row);
                let y = wireRect.center().y;
                let v = this.circuitDefinition.customInitialValues.get(row);
                if (v === undefined) {
                    v = '0';
                }
                let rect = this._wireInitialStateClickableRect(row);
                painter.noteTouchBlocker({rect, cursor: 'pointer'});
                if (this._highlightedSlot === undefined && hand.pos !== undefined && rect.containsPoint(hand.pos)) {
                    painter.fillRect(rect, Config.HIGHLIGHTED_GATE_FILL_COLOR);
                }
                painter.print(
                    `|${v}⟩`,
                    20,
                    y,
                    'right',
                    'middle',
                    Config.FOREGROUND_COLOR,
                    '14px ' + Config.DEFAULT_FONT_FAMILY,
                    20,
                    Config.WIRE_SPACING);
            }
        }

        // Wires (doubled-up for measured sections, dashed after a compact QND readout consumed them).
        let squish = this._squish();
        painter.ctx.save();
        for (let row = 0; row < drawnWireCount; row++) {
            if (row === this._extraWireStartIndex) {
                painter.ctx.globalAlpha *= 0.5;
            }
            let isGone = this._qndMeasuredWires();
            let goneSegments = [];
            let stateColAt = this._wireStateColumns(row);
            painter.trace(trace => {
                let wireRect = this.wireRect(row);
                let y = Math.round(wireRect.center().y - 0.5) + 0.5;
                let lastX = showLabels ? 25 : 5;
                let slotCount = squish === undefined ? this.circuitDefinition.columns.length : squish.count;
                //noinspection ForLoopThatDoesntUseLoopVariableJS
                for (let slot = 0; showLabels ? lastX < painter.width : slot <= slotCount; slot++) {
                    let x = this.opRect(this._colOfSlot(slot)).center().x;
                    let col = stateColAt(slot);
                    if (isGone !== undefined && isGone(col, row)) {
                        goneSegments.push([lastX, x, y]);
                    } else if (this.circuitDefinition.locIsMeasured(new Point(col, row))) {
                        // Measured wire.
                        trace.line(lastX, y-1, x, y-1);
                        trace.line(lastX, y+1, x, y+1);
                    } else {
                        // Unmeasured wire.
                        trace.line(lastX, y, x, y);
                    }
                    lastX = x;
                }
            }).thenStroke(Config.FOREGROUND_COLOR);

            if (goneSegments.length) {
                let ctx = painter.ctx;
                ctx.save();
                ctx.strokeStyle = Config.QND_CONSUMED_WIRE_COLOR;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                for (let [x1, x2, y] of goneSegments) {
                    ctx.moveTo(x1, y - 1.5);
                    ctx.lineTo(x2, y - 1.5);
                    ctx.moveTo(x1, y + 1.5);
                    ctx.lineTo(x2, y + 1.5);
                }
                ctx.stroke();
                ctx.restore();
            }
        }
        painter.ctx.restore();
        if (this._extraWireStartIndex !== undefined && this.circuitDefinition.numWires === Config.MAX_ROW_COUNT) {
            painter.print(
                `(Max wires: ${Config.MAX_ROW_COUNT}. Qubit limit is ${Config.MAX_WIRE_COUNT}; QND record bits don't count.)`,
                5,
                this.wireRect(Config.MAX_ROW_COUNT).y,
                'left',
                'top',
                'red',
                '16px bold monospace',
                400,
                Config.WIRE_SPACING);
        }
    }

    /**
     * @param {!int} col
     * @param {!int} row
     * @param {!Array.<!Point>} focusPosPts
     * @returns {!{isHighlighted: !boolean, isResizeShowing: !boolean, isResizeHighlighted: !boolean}}
     * @private
     */
    _highlightStatusAt(col, row, focusPosPts) {
        if (this._highlightedSlot !== undefined) {
            if (this._highlightedSlot.col === col && this._highlightedSlot.row === row) {
                return {
                    isResizeShowing: true,
                    isResizeHighlighted: this._highlightedSlot.resizeStyle,
                    isHighlighted: !this._highlightedSlot.resizeStyle
                };
            }
        }

        let gate = this.circuitDefinition.gateInSlot(col, row);
        if (gate === undefined || this._highlightedSlot !== undefined) {
            return {
                isResizeShowing: false,
                isResizeHighlighted: false,
                isHighlighted: false
            };
        }

        let gateRect = this.gateRect(row, col, gate.width, gate.height);
        let resizeTabRect = GatePainting.rectForResizeTab(gateRect);

        let isOverGate = pos => {
            let overGate = this.findGateOverlappingPos(pos);
            return overGate !== undefined && overGate.col === col && overGate.row === row;
        };
        let isNotCoveredAt = pos => {
            let g = this.findGateOverlappingPos(pos);
            return g === undefined || (g.col === col && g.row === row);
        };
        let isOverGateResizeTab = pos => isNotCoveredAt(pos) && resizeTabRect.containsPoint(pos);

        let isResizeHighlighted = gate.canChangeInSize() && seq(focusPosPts).any(isOverGateResizeTab);
        let isHighlighted = !isResizeHighlighted && seq(focusPosPts).any(isOverGate);
        let isResizeShowing = gate.canChangeInSize() && (isResizeHighlighted || isHighlighted);

        return {isHighlighted, isResizeShowing, isResizeHighlighted};
    }

    /**
     * @param {!Painter} painter
     * @param {!int} col
     * @param {!int} row
     * @param {!Rect} gateRect
     * @param {!boolean} isHighlighted
     * @private
     */
    _drawGate_disabledReason(painter, col, row, gateRect, isHighlighted) {
        let isDisabledReason = this.circuitDefinition.gateAtLocIsDisabledReason(col, row);
        if (isDisabledReason === undefined) {
            return;
        }
        DisplayedCircuit._paintGateNotice(painter, gateRect, isDisabledReason, isHighlighted, true);
    }

    /**
     * Quirk's yellow notice over a gate, with red text. `strike` crosses it out (the gate isn't applied).
     * @param {!Painter} painter
     * @param {!Rect} gateRect
     * @param {!string} text
     * @param {!boolean} isHighlighted
     * @param {!boolean} strike
     */
    static _paintGateNotice(painter, gateRect, text, isHighlighted, strike) {
        painter.ctx.save();
        if (isHighlighted) {
            painter.ctx.globalAlpha *= 0.3;
        }
        painter.ctx.globalAlpha *= 0.5;
        painter.fillRect(gateRect.paddedBy(5), 'yellow');
        painter.ctx.globalAlpha *= 2;
        if (strike) {
            painter.strokeLine(gateRect.topLeft(), gateRect.bottomRight(), 'orange', 3);
        }
        let r = painter.printParagraph(text, gateRect.paddedBy(5), new Point(0.5, 0.5), 'red');
        painter.ctx.globalAlpha *= 0.5;
        painter.fillRect(r.paddedBy(2), 'yellow');
        painter.ctx.globalAlpha *= 2;
        painter.printParagraph(text, gateRect.paddedBy(5), new Point(0.5, 0.5), 'red');
        painter.ctx.restore()
    }

    /**
     * @param {!Painter} painter
     * @param {!GateColumn} gateColumn
     * @param {!int} col
     * @param {!Hand} hand
     * @param {!CircuitStats} stats
     * @private
     */
    _drawColumn(painter, gateColumn, col, hand, stats) {
        this._drawColumnControlWires(painter, col);
        this._drawColumnDragHighlight(painter, col);

        for (let row = 0; row < this.circuitDefinition.numWires; row++) {
            if (gateColumn.gates[row] === undefined) {
                continue;
            }
            let gate = gateColumn.gates[row];
            let gateRect = this.gateRect(row, col, gate.width, gate.height);

            // Classical record view: controls become part of a conditional gate, readouts become record labels.
            let rec = this._record();
            if (rec !== undefined) {
                if (rec.mergedInto.has(col)) {
                    continue;
                }
                let cond = rec.cond.get(col);
                if (cond !== undefined && cond.ctlRows.indexOf(row) >= 0) {
                    continue;
                }
                let hidden = this._hiddenReadout(col);
                if (hidden !== undefined && row === hidden.readRow) {
                    continue;
                }
                if (cond !== undefined && cond.targets.indexOf(row) >= 0) {
                    this._drawConditionalGate(
                        painter,
                        gateRect,
                        gate,
                        cond.keys,
                        cond.parity === true,
                        this._highlightStatusAt(col, row, hand.hoverPoints()).isHighlighted);
                    painter.noteTouchBlocker({rect: gateRect, cursor: 'pointer'});
                    continue;
                }
            }

            let {isHighlighted, isResizeShowing, isResizeHighlighted} =
                this._highlightStatusAt(col, row, hand.hoverPoints());

            if (/^[XYZ]\^c$/.test(gate.serializedId)) {
                let live = this._recordAlways().live;
                let keys = parseRecArg(gate.param);
                let available = col < live.length ? live[col] : new Set();
                let isSatisfied = keys === undefined ? available.size > 0 : keys.every(k => available.has(k));
                paintClassicalGate(
                    painter.ctx,
                    gateRect,
                    gate.serializedId[0],
                    keys,
                    {highlighted: isHighlighted, bad: !isSatisfied});
                painter.noteTouchBlocker({rect: gateRect, cursor: 'pointer'});
                continue;
            }

            let drawer = gate.customDrawer || GatePainting.DEFAULT_DRAWER;
            painter.noteTouchBlocker({rect: gateRect, cursor: 'pointer'});
            if (gate.canChangeInSize()) {
                painter.noteTouchBlocker({rect: GatePainting.rectForResizeTab(gateRect), cursor: 'ns-resize'});
            }
            drawer(new GateDrawParams(
                painter,
                hand,
                false,
                isHighlighted && !isResizeHighlighted,
                isResizeShowing,
                isResizeHighlighted,
                gateRect,
                gate,
                stats,
                {row, col},
                this._highlightedSlot === undefined ? hand.hoverPoints() : [],
                stats.customStatsForSlot(col, row)));

            this._drawGate_disabledReason(painter, col, row, gateRect, isHighlighted);
        }

        this._drawColumnSurvivalRate(painter, gateColumn, col, stats);
        this._drawCompactQndCheck(painter, gateColumn, col);
    }

    /**
     * @param {!int} col
     * @returns {undefined|!{rows: !Array.<!int>, paulis: !Array.<!string>, readRow: !int}} The compact QND check in
     *     the column, when its readout wire is shown as a classical record bit instead of a qubit.
     * @private
     */
    _hiddenReadout(col) {
        let rec = this._record();
        if (rec === undefined || col >= this.circuitDefinition.columns.length || !QndView.isCompact(col)) {
            return undefined;
        }
        let check = qndCheckInColumn(this.circuitDefinition.columns[col]);
        return check !== undefined && rec.bitRows.has(check.readRow) ? check : undefined;
    }

    /**
     * Labels readouts with the name of the record bit they write (e.g. "→ c₀").
     * @param {!Painter} painter
     * @private
     */
    _drawRecordLabels(painter) {
        let rec = this._record();
        if (rec === undefined) {
            return;
        }
        let ctx = painter.ctx;
        for (let [key, name] of rec.readName) {
            let [col, row] = key.split(':').map(Number);
            if (col >= this.circuitDefinition.columns.length ||
                    row >= this.circuitDefinition.numWires ||
                    this._hiddenReadout(col) !== undefined) {
                continue;
            }
            let r = this.gateRect(row, col);
            ctx.save();
            ctx.font = '16px ' + Config.MATH_FONT_FAMILY;
            let arrowWidth = ctx.measureText('→').width;
            let nameWidth = measureRecExpr(ctx, [name], 15);
            ctx.fillStyle = Config.BACKGROUND_COLOR_CIRCUIT;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(r.right() + 2, r.y, arrowWidth + nameWidth + 5, 17);
            ctx.globalAlpha = 1;
            ctx.fillStyle = Config.QND_ACCENT_COLOR;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('→', r.right() + 3, r.y + 12);
            fillRecExpr(ctx, [name], r.right() + 4 + arrowWidth, r.y + 12, 15);
            ctx.restore();
        }
    }

    /**
     * @param {!Painter} painter
     * @param {!Rect} rect
     * @param {!Gate} gate
     * @param {!Array.<!int>} keys
     * @param {!boolean} parity Whether the gate applies on the XOR (⊕) of the entries rather than their AND (·).
     * @param {!boolean=} isHighlighted
     * @private
     */
    _drawConditionalGate(painter, rect, gate, keys, parity, isHighlighted=false) {
        paintClassicalGate(painter.ctx, rect, gate.serializedId, keys, {
            joiner: parity ? '⊕' : '·',
            highlighted: isHighlighted
        });
    }

    /**
     * @returns {undefined|*} The classical record, when the classical record view is on.
     * @private
     */
    _record() {
        if (QndView.record) {
            return this._recordAlways();
        }
        return undefined;
    }

    /**
     * @returns {*} The classical record of the circuit (cached per circuit definition).
     * @private
     */
    _recordAlways() {
        let def = this.circuitDefinition;
        if (DisplayedCircuit._recCache && DisplayedCircuit._recCache.def === def) {
            return DisplayedCircuit._recCache.info;
        }
        let cols = def.columns.map(column => column.gates.map(g =>
            g === undefined ? undefined :
            g.serializedId === 'QNDread' && g.param ? {id: 'QNDread', arg: g.param} :
            g.serializedId));
        let initialValues = [];
        for (let row = 0; row < def.numWires; row++) {
            let v = def.customInitialValues.get(row);
            initialValues.push(v === undefined ? 0 : v);
        }
        let info = computeRecord(cols, initialValues);
        DisplayedCircuit._recCache = {def, info};
        return info;
    }

    /**
     * Draws record-bit wires as dashed classical wires labelled "c".
     * @param {!Painter} painter
     * @private
     */
    _drawClassicalRows(painter) {
        let rec = this._recordAlways();
        let ctx = painter.ctx;
        let spare = this._spareRecordStart() === undefined ? [] : [this._extraWireStartIndex + 1];
        for (let row of [...rec.bitRows, ...spare]) {
            if (row >= this.circuitDefinition.numWires) {
                continue;
            }
            let y = Math.round(this.wireRect(row).center().y - 0.5) + 0.5;
            ctx.save();
            ctx.fillStyle = Config.BACKGROUND_COLOR_CIRCUIT;
            ctx.fillRect(0, y - 4, painter.width, 8);
            ctx.fillRect(0, y - 12, 24, 24);  // Covers the |0⟩ label, also under a faded spare wire.
            if (spare.indexOf(row) >= 0) {
                ctx.globalAlpha *= 0.5;
            }
            ctx.strokeStyle = Config.CLASSICAL_WIRE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(25, y - 1.5);
            ctx.lineTo(painter.width, y - 1.5);
            ctx.moveTo(25, y + 1.5);
            ctx.lineTo(painter.width, y + 1.5);
            ctx.stroke();
            ctx.fillStyle = Config.CLASSICAL_WIRE_LABEL_COLOR;
            ctx.font = 'italic 13px ' + Config.MATH_FONT_FAMILY;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('c', 20, y);
            ctx.restore();
        }
    }

    /**
     * Draws a compact QND parity check as a single paper-style M_{P⊗k} box over the gates of the column.
     * @param {!Painter} painter
     * @param {!GateColumn} gateColumn
     * @param {!int} col
     * @private
     */
    _drawCompactQndCheck(painter, gateColumn, col) {
        let check = qndCheckInColumn(gateColumn);
        if (check === undefined || !QndView.isCompact(col)) {
            return;
        }
        let firstRow = Math.min(...check.rows);
        let lastRow = Math.max(...check.rows);
        let y1 = this.gateRect(firstRow, col).y;
        let y2 = this.gateRect(lastRow, col).bottom();
        let g = this.gateRect(firstRow, col);
        let box = new Rect(g.x - 2, y1, g.w + 4, y2 - y1);
        let ctx = painter.ctx;
        ctx.save();

        ctx.beginPath();
        GatePainting.traceRoundRect(ctx, box, 4);
        ctx.fillStyle = Config.GATE_FILL_COLOR;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = Config.DEFAULT_STROKE_COLOR;
        ctx.stroke();

        // Input tabs on measured wires, faint pass-through lines on the others.
        let pauliOfRow = new Map(check.rows.map((row, i) => [row, check.paulis[i]]));
        for (let row = firstRow; row <= lastRow; row++) {
            let y = this.gateRect(row, col).center().y;
            if (pauliOfRow.has(row)) {
                if (!QndView.tabs) {
                    continue;
                }
                let tab = new Rect(box.x, y - 7, 11, 14);
                ctx.fillStyle = pauliOfRow.get(row) === 'Z' ? Config.QND_ACCENT_COLOR : Config.QND_X_TAB_COLOR;
                ctx.fillRect(tab.x, tab.y, tab.w, tab.h);
                ctx.fillStyle = Config.QND_TAB_TEXT_COLOR;
                ctx.font = 'bold 9px ' + Config.DEFAULT_FONT_FAMILY;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pauliOfRow.get(row), tab.x + tab.w / 2, y + 0.5);
                ctx.textBaseline = 'alphabetic';
            } else {
                ctx.save();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = Config.DEFAULT_STROKE_COLOR;
                ctx.globalAlpha = 0.45;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(box.x, y);
                ctx.lineTo(box.right(), y);
                ctx.stroke();
                ctx.restore();
            }
        }

        // "M" with the measured Pauli product as subscript.
        let isUniform = check.paulis.every(p => p === check.paulis[0]);
        let subscript = check.paulis.length === 1 ? check.paulis[0] :
            isUniform ? check.paulis[0] + '⊗' + check.paulis.length :
            check.paulis.join('');
        let cx = box.center().x;
        let cy = box.center().y;
        let serif = Config.MATH_FONT_FAMILY;
        ctx.textBaseline = 'alphabetic';
        let mainFont = '15px ' + serif;
        ctx.font = mainFont;
        let mWidth = ctx.measureText('M').width;
        let isTall = box.h >= 70;

        // Keep the label inside the box (right of the input tabs): shrink the subscript, except that in tall
        // boxes long mixed products like XZXZXZ wrap onto several lines instead.
        // Tabs sit at the measured wires' centers; only make room for them when one is level with the label
        // (always, for labels that may wrap onto several lines).
        let labelTop = (isTall ? cy - 8 : cy + 4) - 10;
        let labelBottom = (isTall ? cy - 8 : cy + 4) + 6;
        let tabHitsLabel = QndView.tabs && (isTall && !isUniform || check.rows.some(row => {
            let rowY = this.gateRect(row, col).center().y;
            return rowY + 7 > labelTop && rowY - 7 < labelBottom;
        }));
        let left = box.x + (tabHitsLabel ? 13 : 3);
        let subWidthLimit = box.right() - 3 - left - mWidth;
        let subSize = 10;
        let measureSub = text => {
            ctx.font = subSize + 'px ' + serif;
            return ctx.measureText(text).width;
        };
        let wraps = isTall && !isUniform;
        while (!wraps && subSize > 7 && measureSub(subscript) > subWidthLimit) {
            subSize--;
        }
        let subLines = [subscript];
        if (wraps && measureSub(subscript) > subWidthLimit) {
            subLines = [''];
            for (let ch of subscript) {
                let line = subLines[subLines.length - 1] + ch;
                if (line.length > 1 && measureSub(line) > subWidthLimit) {
                    subLines.push(ch);
                } else {
                    subLines[subLines.length - 1] = line;
                }
            }
        }
        let subWidth = Math.min(subWidthLimit, Math.max(...subLines.map(measureSub)));
        let subLineHeight = subSize + 1;
        let extraHeight = (subLines.length - 1) * subLineHeight;
        let x = left + (box.right() - 3 - left - mWidth - subWidth) / 2;

        let rec = this._record();
        let name = rec !== undefined && rec.readName.has(col + ':' + check.readRow) ?
            rec.readName.get(col + ':' + check.readRow) :
            undefined;
        let isInline = !isTall && name !== undefined && this._hiddenReadout(col) !== undefined;
        let y = (isTall ? cy - 8 : isInline ? cy - 1 : cy + 4) - extraHeight / 2;
        ctx.fillStyle = Config.DEFAULT_TEXT_COLOR;
        ctx.font = mainFont;
        ctx.textAlign = 'left';
        ctx.fillText('M', x, y);
        ctx.font = subSize + 'px ' + serif;
        subLines.forEach((line, i) => ctx.fillText(line, x + mWidth, y + 4 + i * subLineHeight, subWidthLimit));
        cy += extraHeight / 2;

        // Where the outcome goes: "→ cₖ" inline for short boxes, "↓ s" (or the record bit) for tall ones.
        let isExplicit = rec !== undefined && rec.explicit !== undefined && rec.explicit.has(col + ':' + check.readRow);
        if (isInline) {
            ctx.font = '12px ' + serif;
            let arrowWidth = ctx.measureText('→').width + 1;
            let ax = cx + 5 - (arrowWidth + measureRecExpr(ctx, [name], 12)) / 2;
            ctx.textAlign = 'left';
            ctx.fillStyle = Config.QND_ACCENT_COLOR;
            ctx.fillText('→', ax, cy + 15);
            ctx.fillStyle = isExplicit ? Config.RECORD_COLOR : Config.QND_ACCENT_COLOR;
            fillRecExpr(ctx, [name], ax + arrowWidth, cy + 15, 12);
        } else if (isTall) {
            ctx.font = '13px ' + serif;
            ctx.textAlign = 'center';
            ctx.fillText('↓', cx + 5, cy + 9);
            ctx.font = 'italic 15px ' + serif;
            if (name !== undefined) {
                let parts = [name];
                if (isExplicit) {
                    ctx.fillStyle = Config.RECORD_COLOR;
                }
                fillRecExpr(ctx, parts, cx + 5 - measureRecExpr(ctx, parts, 15) / 2, cy + 25, 15);
            } else {
                ctx.fillText('s', cx + 5, cy + 25);
            }
        }
        ctx.restore();
    }

    /**
     * @param {!Painter} painter
     * @param {!GateColumn} gateColumn
     * @param {!int} col
     * @param {!CircuitStats} stats
     * @private
     */
    _drawColumnSurvivalRate(painter, gateColumn, col, stats) {
        if (gateColumn.indexOfNonUnitaryGate() === undefined) {
            return;
        }

        let preRate = stats.survivalRate(col - 1);
        let postRate = stats.survivalRate(col);

        let marginalRate = (postRate - preRate) / preRate;
        if (isNaN(marginalRate) || Math.abs(marginalRate) <= 0.005) {
            return;
        }

        let descAmount;
        let descCategory;
        if (marginalRate < 0) {
            let rate = Math.round(-marginalRate * 100);
            let rateDesc = marginalRate === -1 ? "100" : rate < 100 ? rate : ">99";
            descAmount = `${rateDesc}%`;
            descCategory = 'omits';
        } else {
            let factor = Math.round(marginalRate * 100 + 100);
            descAmount = `${factor}%`;
            descCategory = 'gains';
        }

        let pt = this.opRect(col).bottomCenter();
        painter.print(
            descCategory,
            pt.x,
            pt.y - 28,
            'center',
            'bottom',
            'red',
            '14px ' + Config.DEFAULT_FONT_FAMILY,
            800,
            50);
        painter.print(
            descAmount,
            pt.x,
            pt.y - 13,
            'center',
            'bottom',
            'red',
            '14px ' + Config.DEFAULT_FONT_FAMILY,
            800,
            50);
    }

    _drawColumnDragHighlight(painter, col) {
        if (this._highlightedSlot !== undefined &&
            this._highlightedSlot.col === col &&
            this._highlightedSlot.row === undefined) {
            let rect = this.gateRect(0, col, 1, this._groundedWireCount()).paddedBy(3);
            painter.fillRect(rect, 'rgba(255, 196, 112, 0.7)');
            painter.strokeRect(rect, Config.FOREGROUND_COLOR);
        }
    }

    /**
     * @param {!Painter} painter
     * @private
     */
    _drawRowDragHighlight(painter) {
        if (this._highlightedSlot !== undefined &&
                this._highlightedSlot.col === undefined &&
                this._highlightedSlot.row !== undefined) {

            let row = this._highlightedSlot.row;
            let w = this.gateRect(row, this.clampedCircuitColCount() + 1).x;
            let rect = this.wireRect(row).takeLeft(w);
            painter.fillRect(rect, 'rgba(255, 196, 112, 0.7)');
            painter.strokeRect(rect, Config.FOREGROUND_COLOR);
        }
    }

    /**
     * @param {!Painter} painter
     * @param {!int} columnIndex
     * @private
     */
    _drawColumnControlWires(painter, columnIndex) {
        // Conditional gates and hidden readouts in the record view draw their own connections.
        let rec = this._record();
        if (rec !== undefined && (rec.cond.has(columnIndex) || this._hiddenReadout(columnIndex) !== undefined)) {
            return;
        }

        let x = Math.round(this.opRect(columnIndex).center().x - 0.5) + 0.5;

        // Dashed line indicates effects from non-unitary gates may affect, or appear to affect, other wires.
        if (this.circuitDefinition.columns[columnIndex].hasGatesWithGlobalEffects() && this._slotSize(columnIndex) === 1) {
            painter.ctx.save();
            painter.ctx.setLineDash([1, 4]);
            painter.strokeLine(
                new Point(x, this.gateRect(0, 0).y),
                new Point(x, this.opRect(0).bottom() - 40));
            painter.ctx.restore();
        }

        for (let {first, last, measured} of this.circuitDefinition.controlLinesRanges(columnIndex)) {
            let y1 =  this.wireRect(first).center().y;
            let y2 = this.wireRect(last).center().y;
            if (measured) {
                painter.strokeLine(new Point(x+1, y1), new Point(x+1, y2));
                painter.strokeLine(new Point(x-1, y1), new Point(x-1, y2));
            } else {
                painter.strokeLine(new Point(x, y1), new Point(x, y2));
            }
        }
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     */
    previewDrop(hand) {
        return hand.heldRow !== undefined ? this._previewDropMovedRow(hand) :
            hand.heldColumn !== undefined ? this._previewDropMovedGateColumn(hand) :
            hand.heldGate !== undefined ? this._previewDropMovedGate(hand) :
            this._previewResizedGate(hand);
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     * @private
     */
    _previewDropMovedRow(hand) {
        if (hand.pos === undefined) {
            return this;
        }
        let handWire = this.wireIndexAt(hand.pos.y);
        if (handWire < 0 || handWire >= this.circuitDefinition.numWires) {
            // Dragged the row out of the circuit. Without a spare wire (see withJustEnoughWires), drop the empty wire
            // the row left behind instead of showing it as a new qubit.
            if (this._extraWireStartIndex !== undefined) {
                return this;
            }
            return this.withCircuit(this.circuitDefinition.withWireCount(
                Math.max(Config.MIN_WIRE_COUNT, this.circuitDefinition.minimumRequiredWireCount())));
        }

        let heldRowHeight = seq(hand.heldRow.gates).map(g => g === undefined ? 1 : g.height).max(1);
        handWire = Math.min(handWire, this.circuitDefinition.numWires - heldRowHeight);
        // Record wires only swap places with each other; qubit wires stay above them.
        let bits = [...this._recordAlways().bitRows];
        if (DisplayedCircuit._isRecordRow(hand.heldRow)) {
            let lo = bits.length > 0 ? Math.min(...bits) : this.circuitDefinition.minimumRequiredWireCount();
            let hi = bits.length > 0 ? Math.max(...bits) + 1 : lo;
            handWire = Math.max(lo, Math.min(hi, handWire));
        } else if (bits.length > 0) {
            handWire = Math.min(handWire, Math.min(...bits));
        }

        let newCols = [];
        for (let c = 0; c < this.circuitDefinition.columns.length; c++) {
            let gates = [...this.circuitDefinition.columns[c].gates];
            gates.splice(handWire, 0, hand.heldRow.gates[c]);
            gates.pop();
            newCols.push(new GateColumn(gates));
        }

        let newInitialStates = seq(this.circuitDefinition.customInitialValues.entries()).
            map(([k, v]) => [k + (k >= handWire ? 1 : 0), v]).
            toMap(([k, _]) => k, ([_, v]) => v);
        if (hand.heldRow.initialState !== undefined) {
            newInitialStates.set(handWire, hand.heldRow.initialState);
        }
        let newCircuitDef = this.circuitDefinition.withColumns(newCols).withInitialStates(newInitialStates);

        return this.withCircuit(newCircuitDef).
            _withHighlightedSlot({row: handWire, col: undefined, resizeStyle: false});
    }

    /**
     * @param {!{initialState: *, gates: !Array.<undefined|!Gate>}} heldRow
     * @returns {!boolean} Whether the row is a QND record wire (see recordBitRows).
     * @private
     */
    static _isRecordRow(heldRow) {
        let v = heldRow.initialState;
        return (!v || v === '0') && heldRow.gates.some(g => g !== undefined && g.serializedId === 'QNDread');
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     * @private
     */
    _previewDropMovedGateColumn(hand) {
        if (hand.pos === undefined) {
            return this;
        }
        let handWire = this.wireIndexAt(hand.pos.y);
        if (handWire < 0 || handWire >= Config.MAX_ROW_COUNT || hand.pos.x <= 1) {
            // Dragged the gate column out of the circuit.
            return this;
        }


        let halfCol = this.findOpHalfColumnAt(new Point(hand.pos.x, this.top));
        let mustInsert = halfCol % 1 === 0 &&
            this.circuitDefinition.columns[halfCol] !== undefined &&
            !this.circuitDefinition.columns[halfCol].isEmpty();
        if (mustInsert) {
            let isAfter = hand.pos.x > this.opRect(halfCol).center().x;
            halfCol += isAfter ? 0.5 : -0.5;
        }

        let col = Math.ceil(halfCol);
        let isInsert = halfCol % 1 !== 0;

        let rowShift = Math.round((hand.pos.y - hand.holdOffset.y - this.top) / Config.WIRE_SPACING);
        let newCircuitDef = this._shiftAndSpliceColumn(rowShift, [...hand.heldColumn.gates], col, isInsert);

        return this.withCircuit(newCircuitDef).
            _withHighlightedSlot({row: undefined, col, resizeStyle: false}).
            _withCompressedColumnIndex(isInsert ? col : undefined);
    }

    _shiftAndSpliceColumn(rowShift, gatesOfCol, insertCol, isInsert) {
        // Move gates upward.
        while (rowShift < 0 && gatesOfCol[0] === undefined) {
            gatesOfCol.shift();
            gatesOfCol.push(undefined);
            rowShift += 1;
        }

        // Shift gates downward.
        while (rowShift > 0 && new GateColumn(gatesOfCol).minimumRequiredWireCount() < Config.MAX_ROW_COUNT) {
            gatesOfCol.unshift(undefined);
            if (new GateColumn(gatesOfCol).minimumRequiredWireCount() < gatesOfCol.length) {
                gatesOfCol.pop();
            }
            rowShift -= 1;
        }

        let expandedCircuit = this.circuitDefinition.withWireCount(gatesOfCol.length);
        let newCols = [...expandedCircuit.columns];

        // Move displays rightward.
        while (newCols.length < insertCol) {
            newCols.push(GateColumn.empty(expandedCircuit.numWires));
        }

        newCols.splice(insertCol, isInsert ? 0 : 1, new GateColumn(gatesOfCol));
        return expandedCircuit.withColumns(newCols).withTrailingSpacersIncluded();
    }

    /**
     * Puts the wires in the order they're drawn in, with unused spare wires last (to be trimmed).
     * @returns {!CircuitDefinition}
     * @private
     */
    _defInDrawnOrder() {
        let def = this.circuitDefinition;
        let s = this._extraWireStartIndex;
        let used = r => def.columns.some(col => col.gates[r] !== undefined) || def.customInitialValues.has(r);
        let order = [...Array(def.numWires).keys()].
            sort((r1, r2) => this.wireRect(r1).y - this.wireRect(r2).y).
            filter(r => !(r === s || r === s + 1) || used(r));
        for (let r = 0; r < def.numWires; r++) {
            if (order.indexOf(r) < 0) {
                order.push(r);
            }
        }
        let cols = def.columns.map(col => new GateColumn(order.map(r => col.gates[r])));
        let init = new Map();
        for (let [k, v] of def.customInitialValues.entries()) {
            init.set(order.indexOf(k), v);
        }
        return def.withColumns(cols).withInitialStates(init);
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     * @private
     */
    _previewDropMovedGate(hand) {
        let modificationPoint = this.findModificationIndex(hand);
        if (modificationPoint === undefined) {
            return this;
        }

        // Use the grab offset instead of the gate height so that tall gates are 'sticky' when dragging downward: they
        // aren't removed until the hand actually leaves the circuit area.
        let handRowOffset = Math.floor(hand.holdOffset.y/Config.WIRE_SPACING);
        if (modificationPoint.row + handRowOffset >= this.circuitDefinition.numWires) {
            return this;
        }

        let addedGate = hand.heldGate;

        let emptyCol = GateColumn.empty(this.circuitDefinition.numWires);
        let i = modificationPoint.col;
        let isInserting = modificationPoint.isInsert;
        let row = Math.min(modificationPoint.row, Math.max(0, Config.MAX_ROW_COUNT - addedGate.height));
        let newCols = seq(this.circuitDefinition.columns).
            padded(i, emptyCol).
            ifThen(isInserting, s => s.withInsertedItem(i, emptyCol)).
            padded(i + addedGate.width, emptyCol).
            withTransformedItem(i, c => c.withGatesAdded(row, new GateColumn([addedGate]))).
            toArray();
        let newWireCount = Math.max(
            this._extraWireStartIndex || 0,
            Math.max(
                this.circuitDefinition.numWires,
                addedGate.height + row));
        if (newWireCount > Config.MAX_ROW_COUNT) {
            return this;
        }

        let newCircuitDef = this.circuitDefinition.
            withColumns(newCols).
            withWireCount(newWireCount);
        return this.withCircuit(newCircuitDef).
            _withHighlightedSlot({row, col: modificationPoint.col, resizeStyle: false}).
            _withCompressedColumnIndex(isInserting ? i : undefined).
            _withFallbackExtraWireStartIndex(this.circuitDefinition.numWires);
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     * @private
     */
    _previewResizedGate(hand) {
        if (hand.resizingGateSlot === undefined || hand.pos === undefined) {
            return this;
        }
        let gate = this.circuitDefinition.gateInSlot(hand.resizingGateSlot.x, hand.resizingGateSlot.y);
        if (gate === undefined) {
            return this;
        }
        let row = Math.min(
            this.wireIndexAt(hand.pos.y - hand.holdOffset.y),
            Config.MAX_ROW_COUNT - 1);
        let newGate = seq(gate.gateFamily).minBy(g => Math.abs(g.height - (row - hand.resizingGateSlot.y + 1)));
        let newWireCount = Math.min(Config.MAX_ROW_COUNT,
            Math.max(this.circuitDefinition.numWires, newGate.height + hand.resizingGateSlot.y));
        let newCols = seq(this.circuitDefinition.columns).
            withTransformedItem(hand.resizingGateSlot.x,
                colObj => new GateColumn(seq(colObj.gates).
                    withOverlayedItem(hand.resizingGateSlot.y, newGate).
                    toArray())).
            toArray();

        let newCircuitWithoutOverlapFix = this.circuitDefinition.withColumns(newCols).withWireCount(newWireCount);
        let newCircuitWithOverlapFix = newCircuitWithoutOverlapFix.withHeightOverlapsFixed();
        let newCircuit = newCircuitWithOverlapFix.withTrailingSpacersIncluded();
        return this.withCircuit(newCircuit).
            _withHighlightedSlot(this._highlightedSlot).
            _withCompressedColumnIndex(newCircuitWithoutOverlapFix.isEqualTo(newCircuitWithOverlapFix) ?
                undefined :
                hand.resizingGateSlot.x + 1).
            _withFallbackExtraWireStartIndex(this.circuitDefinition.numWires);
    }

    /**
     * @param {!Hand} hand
     * @returns {!DisplayedCircuit}
     */
    afterDropping(hand) {
        return this.previewDrop(hand)._withCompressedColumnIndex(undefined);
    }

    /**
     * @param {!CircuitDefinition} circuitDefinition
     * @returns {!DisplayedCircuit}
     */
    withCircuit(circuitDefinition) {
        return new DisplayedCircuit(
            this.top,
            circuitDefinition,
            this._compressedColumnIndex,
            this._highlightedSlot,
            this._extraWireStartIndex,
            this._spareAt);
    }

    /**
     * @param {undefined|!int} compressedColumnIndex
     * @returns {!DisplayedCircuit}
     * @private
     */
    _withCompressedColumnIndex(compressedColumnIndex) {
        return new DisplayedCircuit(
            this.top,
            this.circuitDefinition,
            compressedColumnIndex,
            this._highlightedSlot,
            this._extraWireStartIndex,
            this._spareAt);
    }

    /**
     * @param {undefined|!{col: undefined|!int, row: undefined|!int, resizeStyle: !boolean}} slot
     * @returns {!DisplayedCircuit}
     * @private
     */
    _withHighlightedSlot(slot) {
        return new DisplayedCircuit(
            this.top,
            this.circuitDefinition,
            this._compressedColumnIndex,
            slot,
            this._extraWireStartIndex,
            this._spareAt);
    }

    /**
     * @param {undefined|!int} extraWireStartIndex
     * @returns {!DisplayedCircuit}
     * @private
     */
    _withExtraWireStartIndex(extraWireStartIndex) {
        return new DisplayedCircuit(
            this.top,
            this.circuitDefinition,
            this._compressedColumnIndex,
            this._highlightedSlot,
            extraWireStartIndex,
            this._spareAt);
    }

    /**
     * @param {undefined|!int} fallbackExtraWireStartIndex
     * @returns {!DisplayedCircuit}
     * @private
     */
    _withFallbackExtraWireStartIndex(fallbackExtraWireStartIndex) {
        return this._withExtraWireStartIndex(this._extraWireStartIndex || fallbackExtraWireStartIndex);
    }

    /**
     * @param {!Hand} hand
     * @param {!int} extraWireCount
     * @returns {!DisplayedCircuit}
     */
    withJustEnoughWires(hand, extraWireCount) {
        if (hand.heldRow !== undefined &&
                (DisplayedCircuit._isRecordRow(hand.heldRow) || this._recordAlways().bitRows.size > 0)) {
            extraWireCount = 0;  // A moved wire can't go below the record wires, so no new wire is needed.
        }
        let neededWireCountForPlacement = hand.heldGate !== undefined ? hand.heldGate.height : 0;
        let desiredWireCount = this.circuitDefinition.minimumRequiredWireCount();
        let clampedWireCount = Math.min(
            Config.MAX_ROW_COUNT,
            Math.max(
                Math.min(1, neededWireCountForPlacement),
                Math.max(Config.MIN_WIRE_COUNT, desiredWireCount) + extraWireCount));
        let result = this.withCircuit(this.circuitDefinition.withWireCount(clampedWireCount)).
            _withExtraWireStartIndex(extraWireCount === 0 ? undefined : this.circuitDefinition.numWires);
        if (extraWireCount === 1 && hand.heldGate !== undefined && hand.heldGate.height === 1) {
            let spare = this.withJustEnoughWires(hand, 2);
            let s = this.circuitDefinition.numWires;
            let bits = this._recordAlways().bitRows;
            let b = s;
            while (b > 0 && bits.has(b - 1)) {
                b--;
            }
            if (b < s && spare.circuitDefinition.numWires === s + 2 && spare._extraWireStartIndex === s &&
                    this.circuitDefinition.minimumRequiredWireCount() <= s) {
                return new DisplayedCircuit(spare.top, spare.circuitDefinition, spare._compressedColumnIndex,
                    spare._highlightedSlot, s, b);
            }
        }
        return result;
    }

    /**
     * @param {!Point} pos
     * @returns {undefined|!{col: !int, row: !int, offset: !Point}}
     */
    findGateOverlappingPos(pos) {
        let col = this.indexOfDisplayedColumnAt(pos.x, pos.y);
        let row = this.indexOfDisplayedRowAt(pos.y);
        if (col === undefined || row === undefined) {
            return undefined;
        }

        let target = this.circuitDefinition.findGateCoveringSlot(col, row);
        if (target === undefined) {
            return undefined;
        }

        let gateRect = this.gateRect(target.row, target.col, target.gate.width, target.gate.height);
        if (!gateRect.containsPoint(pos)) {
            return undefined;
        }

        return {col: target.col, row: target.row, offset: pos.minus(gateRect.topLeft())};
    }

    /**
     * @param {!Point} pos
     * @returns {undefined|!{col: !int, row: !int, gate: !Gate}}
     */
    findGateWithButtonContaining(pos) {
        let foundPt = this.findGateOverlappingPos(pos);
        if (foundPt === undefined) {
            return undefined;
        }

        let gate = this.circuitDefinition.gateInSlot(foundPt.col, foundPt.row);
        if (gate.onClickGateFunc === undefined) {
            return undefined;
        }

        let buttonRect = GatePainting.gateButtonRect(this.gateRect(foundPt.row, foundPt.col, gate.width, gate.height));
        if (!buttonRect.containsPoint(pos)) {
            return undefined;
        }

        return {col: foundPt.col, row: foundPt.row, gate};
    }

    /**
     * @param {!int} wire
     * @returns {!Rect}
     * @private
     */
    _wireInitialStateClickableRect(wire) {
        let r = this.wireRect(wire);
        r.x = 0;
        r.y += 5;
        r.w = 30;
        r.h -= 10;
        return r;
    }

    /**
     * @param {!Point} pt
     * @returns {undefined|!int}
     */
    findWireWithInitialStateAreaContaining(pt) {
        // Is it in the right vertical band; the one at the start of the circuit?
        if (pt.x < 0 || pt.x > 30) {
            return undefined;
        }

        // Which wire is it? Is it one that's actually in the circuit?
        let wire = this.wireIndexAt(pt.y);
        if (wire < 0 || wire >= this.circuitDefinition.numWires) {
            return undefined;
        }

        // Is it inside the intended click area, instead of just off to the side?
        let r = this._wireInitialStateClickableRect(wire);
        if (!r.containsPoint(pt)) {
            return undefined;
        }

        // Good to go.
        return wire;
    }

    /**
     * @param {!Hand} hand
     * @returns {undefined|!DisplayedCircuit}
     */
    tryClick(hand) {
        if (hand.pos === undefined || hand.heldGate !== undefined) {
            return undefined;
        }

        let clickedInitialStateWire = this.findWireWithInitialStateAreaContaining(hand.pos);
        if (clickedInitialStateWire !== undefined) {
            return this.withCircuit(this.circuitDefinition.withSwitchedInitialStateOn(clickedInitialStateWire))
        }

        let found = this.findGateWithButtonContaining(hand.pos);
        if (found === undefined) {
            return undefined;
        }

        let newGate = found.gate.onClickGateFunc(found.gate);
        let cols = [...this.circuitDefinition.columns];
        let col = cols[found.col];
        let gates = [...col.gates];
        gates.splice(found.row, 1, newGate);
        cols.splice(found.col, 1, new GateColumn(gates));
        return this.withCircuit(this.circuitDefinition.withColumns(cols));
    }

    /**
     * @param {!Hand} hand
     * @param {!boolean=false} duplicate
     * @param {!boolean=false} wholeColumn
     * @param {!boolean=false} ignoreResizeTabs
     * @param {!boolean=false} alt Whether or not to replace grabbed gates with their alternates.
     * @returns {!{newCircuit: !DisplayedCircuit, newHand: !Hand}}
     */
    tryGrab(hand, duplicate=false, wholeColumn=false, ignoreResizeTabs=false, alt=false) {
        // A compact QND check, or a record-view correction X^{c_k} together with its bit-wire controls, is
        // grabbed as a unit.
        if (!wholeColumn && (this._isOnCompactQndCheck(hand) || this._isOnRecordCorrection(hand))) {
            return this._tryGrabWholeColumn(hand, duplicate, alt) || {newCircuit: this, newHand: hand};
        }

        if (wholeColumn) {
            let grabRowResult = this._tryGrabRow(hand, alt);
            if (grabRowResult !== undefined) {
                return grabRowResult;
            }
            return this._tryGrabWholeColumn(hand, duplicate, alt) || {newCircuit: this, newHand: hand};
        }

        let newHand = hand;
        let newCircuit = this;
        if (!ignoreResizeTabs) {
            let resizing = this._tryGrabResizeTab(hand);
            if (resizing !== undefined) {
                newHand = resizing.newHand;
                newCircuit = resizing.newCircuit;
            }
        }

        return newCircuit._tryGrabGate(newHand, duplicate, alt) || {newCircuit, newHand};
    }

    /**
     * @param {!Hand} hand
     * @param {!boolean} alt
     * @returns {undefined|!{newCircuit: !DisplayedCircuit, newHand: !Hand}}
     */
    _tryGrabRow(hand, alt) {
        if (hand.pos === undefined) {
            return undefined;
        }

        // Which wire is it? Is it one that's actually in the circuit?
        let wire = this.wireIndexAt(hand.pos.y);
        if (wire < 0 || wire >= this.circuitDefinition.numWires) {
            return undefined;
        }

        // Is it inside the intended click area, instead of just off to the side?
        let r = this._wireInitialStateClickableRect(wire);
        if (!r.containsPoint(hand.pos)) {
            return undefined;
        }

        let {newCircuit, initialState, rowGates} = this._cutRow(wire);
        let holdOffset = new Point(0, hand.pos.y - r.y);
        if (alt) {
            rowGates = rowGates.map(e => e === undefined ? e : e.alternate);
        }
        return {
            newCircuit: this.withCircuit(newCircuit),
            newHand: hand.withHeldRow({initialState, gates: rowGates}, holdOffset)
        };
    }

    /**
     * @param {!int} row
     * @returns {!{newCircuit: !CircuitDefinition, rowGates: !Array.<undefined|!Gate>, initialState: *}}
     * @private
     */
    _cutRow(row) {
        let row_gates = [];
        let cols = [];
        for (let i = 0; i < this.circuitDefinition.columns.length; i++) {
            let col_gates = [...this.circuitDefinition.columns[i].gates];
            row_gates.push(col_gates[row]);
            col_gates.splice(row, 1);
            col_gates.push(undefined);
            cols.push(new GateColumn(col_gates));
        }
        let newInitialStates = seq(this.circuitDefinition.customInitialValues.entries()).
            filter(([k, _]) => k !== row).
            map(([k, v]) => [k - (k > row ? 1 : 0), v]).
            toMap(([k, _]) => k, ([_, v]) => v);
        return {
            newCircuit: this.circuitDefinition.withColumns(cols).withInitialStates(newInitialStates),
            rowGates: row_gates,
            initialState: this.circuitDefinition.customInitialValues.get(row)
        };
    }

    /**
     * @param {!Hand} hand
     * @returns {!boolean}
     * @private
     */
    _isOnCompactQndCheck(hand) {
        if (hand.isBusy() || hand.pos === undefined) {
            return false;
        }
        let col = this.indexOfDisplayedColumnAt(hand.pos.x, hand.pos.y);
        if (col === undefined || !QndView.isCompact(col)) {
            return false;
        }
        let check = qndCheckInColumn(this.circuitDefinition.columns[col]);
        if (check === undefined) {
            return false;
        }
        let row = this.wireIndexAt(hand.pos.y);
        let firstRow = Math.min(...check.rows);
        let lastRow = Math.max(...check.rows);
        return (row >= firstRow && row <= lastRow) || row === check.readRow;
    }

    /**
     * @param {!Hand} hand
     * @returns {!boolean} Whether the hand is over a gate of a classically controlled correction shown in the
     *     record view (whose controls sit on hidden bit wires, so it must move together with them).
     * @private
     */
    _isOnRecordCorrection(hand) {
        if (hand.isBusy() || hand.pos === undefined) {
            return false;
        }
        let rec = this._record();
        if (rec === undefined) {
            return false;
        }
        let found = this.findGateOverlappingPos(hand.pos);
        if (found === undefined) {
            return false;
        }
        let cond = rec.cond.get(found.col);
        return cond !== undefined && cond.targets.indexOf(found.row) >= 0;
    }

    /**
     * @param {!Hand} hand
     * @param {!boolean} duplicate
     * @param {!boolean} alt
     * @returns {undefined|!{newCircuit: !DisplayedCircuit, newHand: !Hand}}
     */
    _tryGrabGate(hand, duplicate, alt) {
        if (hand.isBusy() || hand.pos === undefined) {
            return undefined;
        }

        let foundPt = this.findGateOverlappingPos(hand.pos);
        if (foundPt === undefined) {
            return undefined;
        }

        let {col, row, offset} = foundPt;
        let gate = this.circuitDefinition.columns[col].gates[row];
        if (alt) {
            gate = gate.alternate;
        }

        let remainingGates = seq(this.circuitDefinition.columns[col].gates).toArray();
        if (!duplicate) {
            remainingGates[row] = undefined;
        }

        let newCols = seq(this.circuitDefinition.columns).
            withOverlayedItem(col, new GateColumn(remainingGates)).
            toArray();
        return {
            newCircuit: new DisplayedCircuit(
                this.top,
                this.circuitDefinition.withColumns(newCols),
                undefined,
                undefined,
                this._extraWireStartIndex,
                this._spareAt),
            newHand: hand.withHeldGate(gate, offset)
        };
    }

    /**
     * @param {!Hand} hand
     * @returns {!{newCircuit: !DisplayedCircuit, newHand: !Hand}}
     */
    _tryGrabResizeTab(hand) {
        if (hand.isBusy() || hand.pos === undefined) {
            return undefined;
        }

        for (let col = 0; col < this.circuitDefinition.columns.length; col++) {
            for (let row = 0; row < this.circuitDefinition.numWires; row++) {
                let gate = this.circuitDefinition.columns[col].gates[row];
                if (gate === undefined) {
                    continue;
                }
                let {isResizeHighlighted} =
                    this._highlightStatusAt(col, row, hand.hoverPoints());
                if (isResizeHighlighted) {
                    let offset = hand.pos.minus(this.gateRect(row + gate.height - 1, col, 1, 1).center());
                    return {
                        newCircuit: this._withHighlightedSlot({col, row, resizeStyle: true}),
                        newHand: hand.withResizeSlot(new Point(col, row), offset)
                    };
                }
            }
        }
        return undefined;
    }

    /**
     * @param {!Hand} hand
     * @param {!boolean} duplicate
     * @param {!boolean} alt Whether or not to replace grabbed gates with their alternates.
     * @returns {undefined|!{newCircuit: !DisplayedCircuit, newHand: !Hand}}
     * @private
     */
    _tryGrabWholeColumn(hand, duplicate, alt) {
        if (hand.isBusy() || hand.pos === undefined) {
            return undefined;
        }

        let col = this.indexOfDisplayedColumnAt(hand.pos.x, hand.pos.y);
        if (col === undefined || this.circuitDefinition.columns[col].isEmpty()) {
            return undefined;
        }

        let newCols = [...this.circuitDefinition.columns];
        if (!duplicate) {
            newCols.splice(col, 1, GateColumn.empty(this.circuitDefinition.numWires));
        }

        let holdOffset = new Point(0, this.wireIndexAt(hand.pos.y) * Config.WIRE_SPACING + Config.WIRE_SPACING/2);
        let grabbedGates = this.circuitDefinition.columns[col];
        if (alt) {
            grabbedGates = new GateColumn(grabbedGates.gates.map(e => e === undefined ? e : e.alternate));
        }
        return {
            newCircuit: this.withCircuit(this.circuitDefinition.withColumns(newCols)),
            newHand: hand.withHeldGateColumn(grabbedGates, holdOffset)
        };
    }

    /**
     * @returns {Infinity|!number}
     */
    stableDuration() {
        return this.circuitDefinition.stableDuration();
    }

    /**
     * @returns {!int}
     */
    /**
     * @returns {!Array.<!int>} The important wires that are qubits, not classical record bits.
     * @private
     */
    _qubitRows() {
        let bitRows = this._recordAlways().bitRows;
        let rows = [];
        for (let i = 0; i < this.importantWireCount(); i++) {
            if (!bitRows.has(i)) {
                rows.push(i);
            }
        }
        return rows.length > 0 ? rows : [0];
    }

    importantWireCount() {
        return Math.max(
            this.circuitDefinition.numWires - (this._spareRecordStart() !== undefined ? 2 :
                this._extraWireStartIndex === Config.MAX_ROW_COUNT ? 0 : 1),
            Config.MIN_WIRE_COUNT,
            this.circuitDefinition.minimumRequiredWireCount());
    }

    /**
     * Draws a peek gate on each wire at the right-hand side of the circuit.
     *
     * @param {!Painter} painter
     * @param {!CircuitStats} stats
     * @param {!Hand} hand
     * @private
     */
    _drawOutputDisplays(painter, stats, hand) {
        let chanceCol = this.clampedCircuitColCount() + 1;
        let blochCol = chanceCol + 1;
        let numWire = this.importantWireCount();

        let bitRows = this._recordAlways().bitRows;
        if (stats.circuitDefinition.numWires > Config.MAX_WIRE_COUNT && stats.qubitRows === undefined) {
            let warnRect = new Rect(this.opRect(chanceCol - 1).x, this.wireRect(0).y, 320, 60);
            painter.fillRect(warnRect, Config.BACKGROUND_COLOR_CIRCUIT);
            painter.printParagraph(
                `Too many qubits to simulate: at most ${Config.MAX_WIRE_COUNT}, including one used by QND ` +
                    `readouts. QND record-bit wires don't count.`,
                warnRect,
                new Point(0, 0),
                Config.RECORD_BAD_COLOR);
            return;
        }
        for (let i = 0; i < numWire; i++) {
            if (bitRows.has(i)) {
                continue;  // Classical record bits: no chance/Bloch output.
            }
            let p = stats.controlledWireProbabilityJustAfter(i, Infinity);
            let chanceRect = this.gateRect(i, chanceCol);
            GatePainting.paintRounded(painter, chanceRect,
                () => MathPainter.paintProbabilityBox(painter, p, chanceRect, hand.hoverPoints()));
            let m = stats.qubitDensityMatrix(Infinity, i);
            if (m !== undefined) {
                paintBlochSphereDisplay(painter, m, this.gateRect(i, blochCol), hand.hoverPoints());
            }
        }

        let bottom = this.wireRect(numWire-1).bottom();
        let x = this.opRect(chanceCol - 1).x;
        painter.printParagraph(
            "Local wire states\n(Chance/Bloch)",
            new Rect(x, bottom+4, 190, 40),
            new Point(0.5, 0),
            Config.MUTED_TEXT_COLOR);

        this._drawOutputSuperpositionDisplay(painter, stats, hand);
    }

    /**
     * @returns {!number} The number of columns used for drawing the circuit, before the output display.
     */
    clampedCircuitColCount() {
        let n = this.circuitDefinition.columns.length;
        let squish = this._squish();
        let savedSlots = squish === undefined ? 0 : n - squish.count;
        return Math.max(
            n,
            Config.MIN_COL_COUNT + savedSlots + (this._compressedColumnIndex !== undefined ? 1 : 0));
    }

    /**
     * Draws a peek gate on each wire at the right-hand side of the circuit.
     *
     * @param {!Painter} painter
     * @param {!CircuitStats} stats
     * @param {!Hand} hand
     * @private
     */
    _drawOutputSuperpositionDisplay(painter, stats, hand) {
        let amplitudeGrid = this._outputStateAsMatrix(stats);
        let gridRect = this._rectForSuperpositionDisplay();

        let numWire = this._qubitRows().length;
        GatePainting.paintRounded(painter, gridRect, () => MathPainter.paintMatrix(
            painter,
            amplitudeGrid,
            gridRect,
            numWire < Config.SIMPLE_SUPERPOSITION_DRAWING_WIRE_THRESHOLD ? Config.SUPERPOSITION_MID_COLOR : undefined,
            Config.FOREGROUND_COLOR,
            numWire < Config.SIMPLE_SUPERPOSITION_DRAWING_WIRE_THRESHOLD ? Config.SUPERPOSITION_FORE_COLOR : undefined,
            Config.SUPERPOSITION_BACK_COLOR));
        let forceSign = v => (v >= 0 ? '+' : '') + v.toFixed(2);
        MathPainter.paintMatrixTooltip(painter, amplitudeGrid, gridRect, hand.hoverPoints(),
            (c, r) => `Amplitude of |${Util.bin(r*amplitudeGrid.width() + c, numWire)}⟩ (decimal ${r*amplitudeGrid.width() + c})`,
            (c, r, v) => 'val:' + v.toString(new Format(false, 0, 5, ", ")),
            (c, r, v) => `mag²:${(v.norm2()*100).toFixed(4)}%, phase:${forceSign(v.phase() * 180 / Math.PI)}°`);

        this._drawOutputSuperpositionDisplay_labels(painter);
    }

    /**
     * @param {!Painter} painter
     * @private
     */
    _drawOutputSuperpositionDisplay_labels(painter) {
        let gridRect = this._rectForSuperpositionDisplay();
        let numWire = this._qubitRows().length;
        _cachedRowLabelDrawer.paint(gridRect.right(), gridRect.y, painter, numWire);
        _cachedColLabelDrawer.paint(gridRect.x, gridRect.bottom(), painter, numWire);
    }

    /**
     * @param {!CircuitStats} stats
     * @returns {!Matrix}
     * @private
     */
    _outputStateAsMatrix(stats) {
        let qubits = this._qubitRows();
        let numWire = qubits.length;
        let full = stats.finalState.rawBuffer();
        // Record bits simulated classically: finalState already holds only the qubits, in stats.qubitRows order.
        let simRows = stats.qubitRows;
        // Record bits are definite (QNDread samples), so slice the state at the most likely bit values.
        let bitMask = 0;
        for (let row of this._recordAlways().bitRows) {
            if (row < stats.circuitDefinition.numWires) {
                bitMask |= 1 << row;
            }
        }
        let best = 0;
        for (let i = 0; i < full.length / 2; i++) {
            let w = full[2*i]*full[2*i] + full[2*i+1]*full[2*i+1];
            let b = full[2*best]*full[2*best] + full[2*best+1]*full[2*best+1];
            if (w > b) {
                best = i;
            }
        }
        let base = simRows === undefined ? best & bitMask : 0;
        let buf = new Float32Array(2 << numWire);
        for (let j = 0; j < (1 << numWire); j++) {
            let i = base;
            qubits.forEach((row, k) => {
                let pos = simRows === undefined ? row : simRows.indexOf(row);
                if ((j & (1 << k)) && pos >= 0) {
                    i |= 1 << pos;
                }
            });
            if (2*i + 1 < full.length) {
                buf[2*j] = full[2*i];
                buf[2*j+1] = full[2*i+1];
            }
        }
        if (bitMask !== 0) {
            // Each frame samples new readout outcomes, and the corrected state differs between them only by a
            // global phase (e.g. −|ψ⟩). Fix it so the largest amplitude is real and positive, instead of flickering.
            // Reference: the first amplitude near the largest, so float noise between equal ones can't swap it.
            let norms = [];
            for (let j = 0; j < buf.length / 2; j++) {
                norms.push(buf[2*j]*buf[2*j] + buf[2*j+1]*buf[2*j+1]);
            }
            let biggest = Math.max(...norms);
            let top = norms.findIndex(v => v >= biggest - 1e-4);
            let mag = Math.hypot(buf[2*top], buf[2*top+1]);
            if (mag > 0) {
                let [cr, ci] = [buf[2*top] / mag, -buf[2*top+1] / mag];
                for (let j = 0; j < buf.length / 2; j++) {
                    let [re, im] = [buf[2*j], buf[2*j+1]];
                    buf[2*j] = re*cr - im*ci;
                    buf[2*j+1] = re*ci + im*cr;
                }
            }
        }

        let [colWires, rowWires] = [Math.floor(numWire/2), Math.ceil(numWire/2)];
        let [colCount, rowCount] = [1 << colWires, 1 << rowWires];
        //noinspection JSCheckFunctionSignatures
        return new Matrix(colCount, rowCount, buf);
    }

    /**
     * @returns {!Rect}
     * @private
     */
    _rectForSuperpositionDisplay() {
        let col = this.clampedCircuitColCount() + EXTRA_COLS_FOR_SINGLE_QUBIT_DISPLAYS + 1;
        let numWire = this._qubitRows().length;
        let [colWires, rowWires] = [Math.floor(numWire/2), Math.ceil(numWire/2)];
        let [colCount, rowCount] = [1 << colWires, 1 << rowWires];
        let topRect = this.gateRect(0, col);
        let bottomRect = this.gateRect(numWire-1, col);
        let gridRect = new Rect(topRect.x, topRect.y, 0, bottomRect.bottom() - topRect.y);
        return gridRect.withW(gridRect.h * (colCount/rowCount));
    }

    /**
     * Draws a peek gate on each wire at the right-hand side of the circuit.
     *
     * @param {!Painter} painter
     * @param {!CircuitStats} stats
     * @private
     */
    _drawHintLabels(painter, stats) {
        let gridRect = this._rectForSuperpositionDisplay();

        // Amplitude hint.
        painter.print(
            'Final amplitudes',
            gridRect.right() + 3,
            gridRect.bottom() + 3,
            'left',
            'top',
            Config.MUTED_TEXT_COLOR,
            '12px ' + Config.DEFAULT_FONT_FAMILY,
            100,
            20);

        // Deferred measurement warning.
        if (this.circuitDefinition.colIsMeasuredMask(Infinity) !== 0) {
            painter.printParagraph(
                "(assuming measurement deferred)",
                new Rect(
                    gridRect.right() + 3,
                    gridRect.bottom() + 20,
                    100,
                    75),
                new Point(0.5, 0),
                'red');
        }

        // Discard rate warning.
        let survivalRate = stats.survivalRate(Infinity);
        if (Math.abs(survivalRate - 1) > 0.01) {
            let desc;
            if (survivalRate < 1) {
                let rate = Math.round(survivalRate * 100);
                let rateDesc = survivalRate === 0 ? "0" :
                    rate > 0 ? rate :
                    "<1";
                desc = `kept: ${rateDesc}%`;
            } else {
                let factor = Math.round(survivalRate * 100);
                desc = `over-unity: ${factor}%`;
            }
            painter.print(
                desc,
                this._rectForSuperpositionDisplay().x - 5,
                gridRect.bottom() + SUPERPOSITION_GRID_LABEL_SPAN,
                'right',
                'bottom',
                'red',
                '14px ' + Config.DEFAULT_FONT_FAMILY,
                800,
                50);
        }
    }

    /**
     * Parses a text diagram of a circuit, with positions marked by numbers, into a displayed circuit and a list of the
     * positions of the marked points.
     *
     * Note: All lines should start with a pipe (|).
     * Note: Follow a number with a carat (^) to indicate a position above the carat.
     * Note: Separate wires with blank lines. Also start and end with blank lines.
     * Note: Hyphens (-) mark wires, but can't be used at gate locations. Use a char mapped to undefined for that.
     *
     * Example diagram, which could be used to seed a drag of the X gate from after the control to under the control:
     *    |
     *    |-H-C-X-
     *    |    0^
     *    |-+-1-+-
     *    |
     *
     * @param {!string} diagramText
     * @param {!Map<!string, undefined|!Gate>} gateMap
     * @returns {!{circuit: !DisplayedCircuit, pts: !Array.<!Point>}}
     */
    static fromTextDiagram(gateMap, diagramText) {
        let lines = diagramText.split('\n').map(e => {
            let p = e.split('|');
            if (p.length !== 2) {
                throw new DetailedError('Bad diagram', {diagramText, gateMap});
            }
            return p[1];
        });
        let circuitDiagramSubset = seq(lines).
            skip(1).
            stride(2).
            map(line => seq(line).skip(1).stride(2).join("")).
            join('\n');
        let top = 10;
        let circuit = new DisplayedCircuit(
            top,
            CircuitDefinition.fromTextDiagram(gateMap, circuitDiagramSubset),
            undefined,
            undefined,
            undefined);
        let pts = Seq.naturals().
            takeWhile(k => diagramText.indexOf(k) !== -1).
            map(k => {
                let pos = seq(lines).mapWithIndex((line, row) => ({row, col: line.indexOf(k)})).
                    filter(e => e.col !== -1).
                    single();
                if (lines[pos.row][pos.col + 1] === '^') {
                    pos.row -= 1;
                    pos.col += 1;
                }
                return new Point(
                    pos.col * Config.WIRE_SPACING / 2 + 35.5,
                    pos.row * Config.WIRE_SPACING / 2 + 10.5);
            }).toArray();
        return {circuit, pts};
    }
}

/**
 * @param {!Painter} painter
 * @param {!CircuitDefinition} circuitDefinition
 * @param {!Rect} rect
 * @param {!boolean} showWires
 * @param {!number} time
 * @returns {!{maxW: !number, maxH: !number}}
 */
function drawCircuitTooltip(painter, circuitDefinition, rect, showWires, time) {
    let displayed = new DisplayedCircuit(
        0,
        circuitDefinition,
        undefined,
        undefined,
        undefined);
    let neededWidth = displayed.desiredWidth(true);
    let neededHeight = displayed.desiredHeight(true);
    let scaleX = rect.w / neededWidth;
    let scaleY = rect.h / neededHeight;
    if (showWires) {
        let s = Math.min(scaleX, scaleY);
        scaleX = s;
        scaleY = s;
    }
    let stats = CircuitStats.withNanDataFromCircuitAtTime(circuitDefinition, time);
    try {
        painter.ctx.save();
        painter.ctx.translate(rect.x, rect.y);
        painter.ctx.scale(Math.min(1, scaleX), Math.min(1, scaleY));
        painter.ctx.translate(0, 0);
        displayed.paint(
            painter,
            Hand.EMPTY,
            stats,
            true,
            showWires);
    } finally {
        painter.ctx.restore();
    }
    return {maxW: neededWidth*scaleX, maxH: neededHeight*scaleY};
}

/**
 * @param {!GateDrawParams} args
 */
let GATE_CIRCUIT_DRAWER = args => {
    let circuit = args.gate.knownCircuit;
    if (circuit === undefined || args.gate.symbol !== '') {
        if (args.gate.stableDuration() === Infinity) {
            GatePainting.DEFAULT_DRAWER(args);
        } else {
            GatePainting.makeCycleDrawer()(args);
        }
        return;
    }

    let toolboxColor = args.gate.stableDuration() === Infinity ?
        Config.GATE_FILL_COLOR :
        Config.TIME_DEPENDENT_HIGHLIGHT_COLOR;
    GatePainting.paintBackground(args, toolboxColor);
    drawCircuitTooltip(args.painter, args.gate.knownCircuitNested, args.rect, false, args.stats.time);
    GatePainting.paintOutline(args);
    if (args.isHighlighted) {
        args.painter.ctx.save();
        args.painter.ctx.globalAlpha *= 0.9;
        args.painter.fillRect(args.rect, Config.HIGHLIGHTED_GATE_FILL_COLOR);
        args.painter.ctx.restore();
    }
    GatePainting.paintOutline(args);
};

/**
 * @param {!Painter} painter
 * @param {!number} dy
 * @param {!int} n
 * @param {!function(!int) : !String} labeller
 * @param {!number} boundingWidth
 * @private
 */
function _drawLabelsReasonablyFast(painter, dy, n, labeller, boundingWidth) {
    let ctx = painter.ctx;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    painter.ctx.font = '12px monospace';
    let w = Math.max(
        painter.ctx.measureText(labeller(0)).width,
        painter.ctx.measureText(labeller(n-1)).width);
    let h = ctx.measureText("0").width * 2.5;
    let scale = Math.min(Math.min((boundingWidth-2) / w, dy / h), 1);

    // Row labels.
    let step = dy/scale;
    let pad = 1/scale;
    ctx.scale(scale, scale);
    ctx.translate(0, dy*0.5/scale - h*0.5);
    ctx.fillStyle = Config.BORDER_COLOR;
    if (h < step*0.95) {
        for (let i = 0; i < n; i++) {
            ctx.fillRect(0, step*i, w + 2*pad, h);
        }
    } else {
        ctx.fillRect(0, 0, w + 2*pad, step*n);
    }
    ctx.fillStyle = Config.FOREGROUND_COLOR;
    for (let i = 0; i < n; i++) {
        ctx.fillText(labeller(i), pad, h*0.5 + step*i);
    }
    ctx.restore();
}

let _cachedRowLabelDrawer = new CachablePainting(
    numWire => ({
        width: SUPERPOSITION_GRID_LABEL_SPAN,
        height: (numWire - 1) * Config.WIRE_SPACING + Config.GATE_RADIUS * 2
    }),
    (painter, numWire) => {
        let [colWires, rowWires] = [Math.floor(numWire/2), Math.ceil(numWire/2)];
        let rowCount = 1 << rowWires;
        //noinspection JSCheckFunctionSignatures
        let suffix = colWires < 4 ? "_".repeat(colWires) : "_..";
        //noinspection JSCheckFunctionSignatures
        _drawLabelsReasonablyFast(
            painter,
            painter.height / rowCount,
            rowCount,
            i => Util.bin(i, rowWires) + suffix,
            SUPERPOSITION_GRID_LABEL_SPAN);
    });

let _cachedColLabelDrawer = new CachablePainting(
    numWire => {
        let [colWires, rowWires] = [Math.floor(numWire/2), Math.ceil(numWire/2)];
        let [colCount, rowCount] = [1 << colWires, 1 << rowWires];
        let total_height = (numWire - 1) * Config.WIRE_SPACING + Config.GATE_RADIUS * 2;
        let cellDiameter = total_height / rowCount;
        return {
            width: colCount * cellDiameter,
            height: SUPERPOSITION_GRID_LABEL_SPAN
        }
    },
    (painter, numWire) => {
        let [colWires, rowWires] = [Math.floor(numWire/2), Math.ceil(numWire/2)];
        let colCount = 1 << colWires;
        let dw = painter.width / colCount;

        painter.ctx.translate(colCount*dw, 0);
        painter.ctx.rotate(Math.PI/2);
        //noinspection JSCheckFunctionSignatures
        let prefix = rowWires < 4 ? "_".repeat(rowWires) : ".._";
        //noinspection JSCheckFunctionSignatures
        _drawLabelsReasonablyFast(
            painter,
            dw,
            colCount,
            i => prefix + Util.bin(colCount-1-i, colWires),
            SUPERPOSITION_GRID_LABEL_SPAN);
    });

export {DisplayedCircuit, drawCircuitTooltip, GATE_CIRCUIT_DRAWER}
