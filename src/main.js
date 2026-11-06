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

// It's important that the polyfills and error fallback get loaded first!
import {} from "./browser/Polyfills.js"
import {hookErrorHandler} from "./fallback.js"
hookErrorHandler();
import {doDetectIssues} from "./issues.js"
doDetectIssues();

import {CircuitStats} from "./circuit/CircuitStats.js"
import {CooldownThrottle} from "./base/CooldownThrottle.js"
import {Config} from "./Config.js"
import {DisplayedInspector} from "./ui/DisplayedInspector.js"
import {Painter} from "./draw/Painter.js"
import {Rect} from "./math/Rect.js"
import {RestartableRng} from "./base/RestartableRng.js"
import {Revision} from "./base/Revision.js"
import {initSerializer, fromJsonText_CircuitDefinition} from "./circuit/Serializer.js"
import {TouchScrollBlocker} from "./browser/TouchScrollBlocker.js"
import {Util} from "./base/Util.js"
import {initializedWglContext} from "./webgl/WglContext.js"
import {watchDrags, isMiddleClicking, eventPosRelativeTo} from "./browser/MouseWatcher.js"
import {ObservableValue, ObservableSource} from "./base/Obs.js"
import {initExports, obsExportsIsShowing} from "./ui/exports.js"
import {initForge, obsForgeIsShowing} from "./ui/forge.js"
import {initMenu, obsMenuIsShowing, closeMenu} from "./ui/menu.js"
import {initUndoRedo} from "./ui/undo.js"
import {initClear} from "./ui/clear.js"
import {initQnd, editClassicalExponent, editReadoutName} from "./ui/qnd.js"
import {QndView, qndCheckInColumn} from "./ui/qndView.js"
import {initUrlCircuitSync} from "./ui/url.js"
import {initTitleSync} from "./ui/title.js"
import {simulate} from "./ui/sim.js"
import {GatePainting} from "./draw/GatePainting.js"
import {GATE_CIRCUIT_DRAWER} from "./ui/DisplayedCircuit.js"
import {GateColumn} from "./circuit/GateColumn.js";
import {Point} from "./math/Point.js";
initSerializer(
    GatePainting.LABEL_DRAWER,
    GatePainting.MATRIX_DRAWER,
    GATE_CIRCUIT_DRAWER,
    GatePainting.LOCATION_INDEPENDENT_GATE_DRAWER);

const canvasDiv = document.getElementById("canvasDiv");

//noinspection JSValidateTypes
/** @type {!HTMLCanvasElement} */
const canvas = document.getElementById("drawCanvas");
//noinspection JSValidateTypes
if (!canvas) {
    throw new Error("Couldn't find 'drawCanvas'");
}
canvas.width = canvasDiv.clientWidth;
canvas.height = window.innerHeight*0.9;
let haveLoaded = false;
const semiStableRng = (() => {
    const target = {cur: new RestartableRng()};
    let cycleRng;
    cycleRng = () => {
        target.cur = new RestartableRng();
        //noinspection DynamicallyGeneratedCodeJS
        setTimeout(cycleRng, Config.SEMI_STABLE_RANDOM_VALUE_LIFETIME_MILLIS*0.99);
    };
    cycleRng();
    return target;
})();

//noinspection JSValidateTypes
/** @type {!HTMLDivElement} */
const inspectorDiv = document.getElementById("inspectorDiv");

/** @type {ObservableValue.<!DisplayedInspector>} */
const displayed = new ObservableValue(
    DisplayedInspector.empty(new Rect(0, 0, canvas.clientWidth, canvas.clientHeight)));
const mostRecentStats = new ObservableValue(CircuitStats.EMPTY);
/** @type {!Revision} */
let revision = Revision.startingAt(displayed.get().snapshot());

revision.latestActiveCommit().subscribe(jsonText => {
    let circuitDef = fromJsonText_CircuitDefinition(jsonText);
    let newInspector = displayed.get().withCircuitDefinition(circuitDef);
    displayed.set(newInspector);
});

/**
 * @param {!DisplayedInspector} curInspector
 * @returns {{w: number, h: !number}}
 */
let desiredCanvasSizeFor = curInspector => {
    return {
        w: Math.max(canvasDiv.clientWidth / Config.CANVAS_SCALE, curInspector.desiredWidth()),
        h: curInspector.desiredHeight()
    };
};

/**
 * @param {!DisplayedInspector} ins
 * @returns {!DisplayedInspector}
 */
const syncArea = ins => {
    let size = desiredCanvasSizeFor(ins);
    ins.updateArea(new Rect(0, 0, size.w, size.h));
    return ins;
};

// Gradually fade out old errors as user manipulates circuit.
displayed.observable().
    map(e => e.displayedCircuit.circuitDefinition).
    whenDifferent(Util.CUSTOM_IS_EQUAL_TO_EQUALITY).
    subscribe(() => {
        let errDivStyle = document.getElementById('error-div').style;
        errDivStyle.opacity *= 0.9;
        if (errDivStyle.opacity < 0.06) {
            errDivStyle.display = 'None'
        }
    });

/** @type {!CooldownThrottle} */
let redrawThrottle;
/** @type {undefined|!Point} */
let dragStartPos = undefined;
/** @type {undefined|!DisplayedCircuit} */
let lastShownCircuit = undefined;
const scrollBlocker = new TouchScrollBlocker(canvasDiv);
const redrawNow = () => {
    if (!haveLoaded) {
        // Don't draw while loading. It's a huge source of false-positive circuit-load-failed errors during development.
        return;
    }

    let shown = syncArea(displayed.get()).previewDrop();
    if (displayed.get().hand.isHoldingSomething() && !shown.hand.isHoldingSomething()) {
        shown = shown.withHand(shown.hand.withHeldGateColumn(new GateColumn([]), new Point(0, 0)))
    }
    let stats = simulate(shown.displayedCircuit.circuitDefinition);
    mostRecentStats.set(stats);

    // Freeze the classical-record layout while a drag is in progress, and animate when it starts or stops.
    let hand = displayed.get().hand;
    if (hand.isHoldingSomething() && hand.pos !== undefined) {
        if (dragStartPos === undefined) {
            dragStartPos = hand.pos;
            QndView.frozen = lastShownCircuit === undefined || lastShownCircuit._squish() === undefined
                ? undefined
                : {n: lastShownCircuit.circuitDefinition.columns.length, info: lastShownCircuit._squish()};
        }
    } else {
        dragStartPos = undefined;
        QndView.frozen = undefined;
    }
    let dragging = dragStartPos !== undefined && hand.pos.distanceTo(dragStartPos) > 6;
    if (dragging !== QndView.dragging) {
        if (QndView.record && lastShownCircuit !== undefined) {
            let n = lastShownCircuit.circuitDefinition.columns.length;
            let fromX = [];
            for (let i = 0; i < n + 40; i++) {
                fromX.push(lastShownCircuit.opRect(i).x);
            }
            QndView.anim = {fromX, img: undefined, n, t0: performance.now(), dur: 220};
        }
        QndView.dragging = dragging;
    }
    lastShownCircuit = shown.displayedCircuit;

    // Draw at the screen's pixel density (high-DPI screens, browser zoom) so the circuit isn't blurry.
    let size = desiredCanvasSizeFor(shown);
    // Zoomed (Config.CANVAS_SCALE) by drawing at a higher or lower ratio: the layout keeps its own units.
    let pixelRatio = (window.devicePixelRatio || 1) * Config.CANVAS_SCALE;
    canvas.width = Math.round(size.w * pixelRatio);
    canvas.height = Math.round(size.h * pixelRatio);
    canvas.style.width = size.w * Config.CANVAS_SCALE + 'px';
    canvas.style.height = size.h * Config.CANVAS_SCALE + 'px';
    let painter = new Painter(canvas, semiStableRng.cur.restarted(), pixelRatio);
    shown.updateArea(painter.paintableArea());
    shown.paint(painter, stats);
    painter.paintDeferred();

    // Cross-fade from the snapshot taken before the record view changed.
    let anim = QndView.anim;
    if (anim !== undefined) {
        let progress = (performance.now() - anim.t0) / anim.dur;
        if (progress >= 1) {
            QndView.anim = undefined;
        } else {
            let alpha = anim.img === undefined ? 0 : Math.max(0, 1 - progress / 0.6);
            if (alpha > 0) {
                painter.ctx.save();
                painter.ctx.globalAlpha = alpha * alpha;
                painter.ctx.drawImage(anim.img, 0, 0, anim.img.width / pixelRatio, anim.img.height / pixelRatio);
                painter.ctx.restore();
            }
            window.requestAnimationFrame(() => redrawThrottle.trigger());
        }
    }

    displayed.get().hand.paintCursor(painter);
    scrollBlocker.setBlockers(painter.touchBlockers, painter.desiredCursorStyle);
    canvas.style.cursor = QndView.placing !== undefined ? 'crosshair' : painter.desiredCursorStyle || 'auto';

    let dt = displayed.get().stableDuration();
    if (dt === 0) {
        window.requestAnimationFrame(() => redrawThrottle.trigger());
    } else if (dt < Infinity && !QndView.pauseSampling && resampleTimer === undefined) {
        // Only sampled outcomes change: draw a new sample now and then, not every frame (and not in a hidden tab).
        resampleTimer = setTimeout(() => {
            resampleTimer = undefined;
            if (!document.hidden) {
                redrawThrottle.trigger();
            }
        }, dt * 1000);
    }
};
let resampleTimer = undefined;
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        redrawThrottle.trigger();
    }
});

redrawThrottle = new CooldownThrottle(redrawNow, Config.REDRAW_COOLDOWN_MILLIS, 0.1, true);
QndView.requestRedraw = () => redrawThrottle.trigger();
QndView.onBeforeViewChange = () => {
    let circ = displayed.get().displayedCircuit;
    let n = circ.circuitDefinition.columns.length;
    let fromX = [];
    for (let i = 0; i < n + 40; i++) {
        fromX.push(circ.opRect(i).x);
    }
    let img = document.createElement('canvas');
    img.width = canvas.width;
    img.height = canvas.height;
    img.getContext('2d').drawImage(canvas, 0, 0);
    let reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    QndView.anim = reduceMotion ? undefined : {fromX, img, n, t0: performance.now(), dur: 320};
};
window.addEventListener('resize', () => redrawThrottle.trigger(), false);
displayed.observable().subscribe(() => redrawThrottle.trigger());

/** @type {undefined|!string} */
let clickDownGateButtonKey = undefined;
canvasDiv.addEventListener('click', ev => {
    let pt = eventPosRelativeTo(ev, canvasDiv);
    let curInspector = displayed.get();
    if (curInspector.tryGetHandOverButtonKey() !== clickDownGateButtonKey) {
        return;
    }
    let clicked = syncArea(curInspector.withHand(curInspector.hand.withPos(pt))).tryClick();
    if (clicked !== undefined) {
        revision.commit(clicked.afterTidyingUp().snapshot());
    }
});

watchDrags(canvasDiv,
    /**
     * Grab
     * @param {!Point} pt
     * @param {!MouseEvent|!TouchEvent} ev
     */
    (pt, ev) => {
        let oldInspector = displayed.get();
        let newHand = oldInspector.hand.withPos(pt);
        let newInspector = syncArea(oldInspector.withHand(newHand));
        clickDownGateButtonKey = (
            ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey ? undefined : newInspector.tryGetHandOverButtonKey());
        if (clickDownGateButtonKey !== undefined) {
            displayed.set(newInspector);
            return;
        }

        newInspector = newInspector.afterGrabbing(ev.shiftKey, ev.ctrlKey || ev.metaKey);
        if (displayed.get().isEqualTo(newInspector) || !newInspector.hand.isBusy()) {
            return;
        }

        // Add extra wire temporarily.
        revision.startedWorkingOnCommit();
        displayed.set(
            syncArea(oldInspector.withHand(newHand).withJustEnoughWires(newInspector.hand, 1)).
                afterGrabbing(ev.shiftKey, ev.ctrlKey || ev.metaKey, false, ev.altKey));

        ev.preventDefault();
    },
    /**
     * Cancel
     * @param {!MouseEvent|!TouchEvent} ev
     */
    ev => {
        revision.cancelCommitBeingWorkedOn();
        ev.preventDefault();
    },
    /**
     * Drag
     * @param {undefined|!Point} pt
     * @param {!MouseEvent|!TouchEvent} ev
     */
    (pt, ev) => {
        if (!displayed.get().hand.isBusy()) {
            return;
        }

        let newHand = displayed.get().hand.withPos(pt);
        let newInspector = displayed.get().withHand(newHand);
        displayed.set(newInspector);
        ev.preventDefault();
    },
    /**
     * Drop
     * @param {undefined|!Point} pt
     * @param {!MouseEvent|!TouchEvent} ev
     */
    (pt, ev) => {
        if (!displayed.get().hand.isBusy()) {
            return;
        }

        let newHand = displayed.get().hand.withPos(pt);
        let newInspector = syncArea(displayed.get()).withHand(newHand).afterDropping().afterTidyingUp();
        let clearHand = newInspector.hand.withPos(undefined);
        let clearInspector = newInspector.withJustEnoughWires(clearHand, 0);
        revision.commit(clearInspector.snapshot());
        ev.preventDefault();
    });

// Double-click a classical correction to pick its record entry, or a QND check to expand/collapse it.
// While a building block is being placed, a click on the circuit places it instead of grabbing a gate.
let placeBlockAt = ev => {
    if (QndView.placing === undefined) {
        return;
    }
    let circ = displayed.get().displayedCircuit;
    let touch = ev.touches !== undefined && ev.touches.length > 0 ? ev.touches[0] : ev;
    let pt = eventPosRelativeTo(touch, canvas);
    if (pt.y < circ.top || pt.y > circ.top + circ.desiredHeight()) {
        return;
    }
    let n = circ.circuitDefinition.columns.length;
    let col = circ.indexOfDisplayedColumnAt(pt.x, pt.y);
    if (col === undefined) {
        col = circ.toColumnSpaceCoordinate(pt.x) < 0 ? 0 : n;
    }
    ev.stopImmediatePropagation();
    ev.preventDefault();
    QndView.placeBlock(col, Math.max(0, circ.wireIndexAt(pt.y)));
};
canvasDiv.addEventListener('mousedown', placeBlockAt, true);
canvasDiv.addEventListener('touchstart', placeBlockAt, true);

// Grabbing a building block's label picks the whole block up; the next click puts it down (see placeBlockAt).
let grabBlockAt = ev => {
    if (QndView.placing !== undefined) {
        return;
    }
    let touch = ev.touches !== undefined && ev.touches.length > 0 ? ev.touches[0] : ev;
    let found = displayed.get().displayedCircuit.blockLabelAt(eventPosRelativeTo(touch, canvas));
    if (found === undefined) {
        return;
    }
    ev.stopImmediatePropagation();
    ev.preventDefault();
    QndView.pickUpBlock(found);
};
canvasDiv.addEventListener('mousedown', grabBlockAt, true);
canvasDiv.addEventListener('touchstart', grabBlockAt, true);

canvasDiv.addEventListener('dblclick', ev => {
    let circ = displayed.get().displayedCircuit;
    let pt = eventPosRelativeTo(ev, canvas);
    let col = circ.indexOfDisplayedColumnAt(pt.x, pt.y);
    if (col === undefined || pt.y < circ.top || pt.y > circ.top + circ.desiredHeight()) {
        return;
    }
    let row = circ.wireIndexAt(pt.y);
    let def = circ.circuitDefinition;
    let gate = row >= 0 && row < def.numWires ? def.columns[col].gates[row] : undefined;
    if (gate !== undefined) {
        let current = undefined;
        if (/^[XYZ]\^c$/.test(gate.serializedId)) {
            current = gate.param === 'last' || gate.param === undefined ? '' : String(gate.param);
        } else if (QndView.record && /^[XYZ]$/.test(gate.serializedId)) {
            let rec = circ._record();
            let cond = rec.cond.get(rec.mergedInto.has(col) ? rec.mergedInto.get(col) : col);
            if (cond !== undefined && cond.targets.indexOf(row) >= 0) {
                current = cond.keys.map((k, i) => (cond.negated && cond.negated[i] ? '¬' : '') + k).
                    join(cond.parity ? '+' : '*');
            }
        }
        if (current !== undefined) {
            let r = circ.gateRect(row, col);
            let box = canvas.getBoundingClientRect();
            editClassicalExponent(revision, {
                left: box.left + window.scrollX + r.x * Config.CANVAS_SCALE,
                top: box.top + window.scrollY + r.y * Config.CANVAS_SCALE,
                width: r.w,
                height: r.h
            }, col, row, current);
            ev.preventDefault();
            return;
        }
    }

    let check = qndCheckInColumn(circ.circuitDefinition.columns[col]);
    if (check === undefined) {
        return;
    }
    if (QndView.record && QndView.isCompact(col)) {
        let rec = circ._record();
        let key = col + ':' + check.readRow;
        let topRow = Math.min(...check.rows);
        let bottomRow = Math.max(...check.rows);
        let topRect = circ.gateRect(topRow, col);
        let bottomRect = circ.gateRect(bottomRow, col);
        let box = canvas.getBoundingClientRect();
        let name = String(rec.readName.get(key));
        editReadoutName(revision, {
            left: box.left + window.scrollX + topRect.x * Config.CANVAS_SCALE,
            top: box.top + window.scrollY + topRect.y * Config.CANVAS_SCALE,
            width: topRect.w * Config.CANVAS_SCALE,
            height: (bottomRect.bottom() - topRect.y) * Config.CANVAS_SCALE
        }, col, check.readRow, name, () => QndView.toggle(col));
        ev.preventDefault();
        return;
    }
    QndView.toggle(col);
    ev.preventDefault();
});

// Middle-click to delete a gate.
canvasDiv.addEventListener('mousedown', ev => {
    if (!isMiddleClicking(ev)) {
        return;
    }
    let cur = syncArea(displayed.get());
    let initOver = cur.tryGetHandOverButtonKey();
    let newHand = cur.hand.withPos(eventPosRelativeTo(ev, canvas));
    let newInspector;
    if (initOver !== undefined && initOver.startsWith('wire-init-')) {
        let newCircuit = cur.displayedCircuit.circuitDefinition.withSwitchedInitialStateOn(
            parseInt(initOver.substr(10)), 0);
        newInspector = cur.withCircuitDefinition(newCircuit).withHand(newHand).afterTidyingUp();
    } else {
        newInspector = cur.
            withHand(newHand).
            afterGrabbing(false, false, true, false). // Grab the gate.
            withHand(newHand). // Lose the gate.
            afterTidyingUp().
            withJustEnoughWires(newHand, 0);
    }
    if (!displayed.get().isEqualTo(newInspector)) {
        revision.commit(newInspector.snapshot());
        ev.preventDefault();
    }
});

// When mouse moves without dragging, track it (for showing hints and things).
canvasDiv.addEventListener('mousemove', ev => {
    if (!displayed.get().hand.isBusy()) {
        let newHand = displayed.get().hand.withPos(eventPosRelativeTo(ev, canvas));
        let newInspector = displayed.get().withHand(newHand);
        displayed.set(newInspector);
    }
});
canvasDiv.addEventListener('mouseleave', () => {
    if (!displayed.get().hand.isBusy()) {
        let newHand = displayed.get().hand.withPos(undefined);
        let newInspector = displayed.get().withHand(newHand);
        displayed.set(newInspector);
    }
});

let obsIsAnyOverlayShowing = new ObservableSource();
initUrlCircuitSync(revision);
initExports(revision, mostRecentStats, obsIsAnyOverlayShowing.observable());
initForge(revision, obsIsAnyOverlayShowing.observable());
initUndoRedo(revision, obsIsAnyOverlayShowing.observable());
initClear(revision, obsIsAnyOverlayShowing.observable());
initMenu(revision, obsIsAnyOverlayShowing.observable());
initQnd(revision);
initTitleSync(revision);
obsForgeIsShowing.
    zipLatest(obsExportsIsShowing, (e1, e2) => e1 || e2).
    zipLatest(obsMenuIsShowing, (e1, e2) => e1 || e2).
    whenDifferent().
    subscribe(e => {
        obsIsAnyOverlayShowing.send(e);
        canvasDiv.tabIndex = e ? -1 : 0;
    });

// If the webgl initialization is going to fail, don't fail during the module loading phase.
haveLoaded = true;
setTimeout(() => {
    inspectorDiv.style.display = 'block';
    redrawNow();
    document.getElementById("loading-div").style.display = 'none';
    document.getElementById("close-menu-button").style.display = 'block';
    if (!displayed.get().displayedCircuit.circuitDefinition.isEmpty()) {
        closeMenu();
    }

    try {
        initializedWglContext().onContextRestored = () => redrawThrottle.trigger();
    } catch (ex) {
        // If that failed, the user is already getting warnings about WebGL not being supported.
        // Just silently log it.
        console.error(ex);
    }
}, 0);
