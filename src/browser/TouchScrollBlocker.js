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

import {Rect} from "../math/Rect.js"
import {Config} from "../Config.js"

class TouchScrollBlocker {
    /**
     * @param {HTMLElement} parentElement
     */
    constructor(parentElement) {
        /**
         * @type {!HTMLElement}
         * @private
         */
        this._parentElement = parentElement;

        /**
         * @type {!{div: !HTMLDivElement, area: !Rect}}
         * @private
         */
        this._curBlockers = [];

        /**
         * @type {!int}
         * @private
         */
        this._curShowing = 0;
    }

    //noinspection Eslint
    /**
     * @param {!Array.<!{rect: !Rect, cursor: undefined|!string}>} desiredBlockers
     * @param {undefined|!string} overrideCursorStyle
     */
    setBlockers(desiredBlockers, overrideCursorStyle) {
        while (this._curBlockers.length < desiredBlockers.length) {
            let blockerDiv = document.createElement('div');
            // Scrolling may start on a gate: a drag only starts after a short hold (see MouseWatcher), which then
            // stops the scroll itself.
            blockerDiv.style.touchAction = 'manipulation';
            blockerDiv.style.position = 'absolute';
            blockerDiv.style.opacity = 0.0001;
            this._parentElement.appendChild(blockerDiv);
            this._curBlockers.push({div: blockerDiv, area: undefined});
        }

        // Positioning.
        for (let i = 0; i < desiredBlockers.length; i++) {
            let desiredArea = desiredBlockers[i].rect;
            let desiredCursor = overrideCursorStyle || desiredBlockers[i].cursor || 'auto';
            let cur = this._curBlockers[i];
            let style = cur.div.style;

            // The areas are in canvas units: zoom them like the canvas (Config.CANVAS_SCALE), or they'd sit off
            // the gates they cover (letting a swipe on a gate scroll and grab it) and stretch the scrolling box.
            let s = Config.CANVAS_SCALE;
            if (!desiredArea.isEqualTo(cur.area) || cur.scale !== s) {
                cur.area = desiredArea;
                cur.scale = s;
                style.left = desiredArea.x * s + "px";
                style.top = desiredArea.y * s + "px";
                style.width = desiredArea.w * s + "px";
                style.height = desiredArea.h * s + "px";
            }
            if (style.cursor !== desiredCursor) {
                style.cursor = desiredCursor;
            }
        }

        // Visibility.
        while (this._curShowing < desiredBlockers.length) {
            this._curBlockers[this._curShowing].div.style.display = 'inline';
            this._curShowing++;
        }
        while (this._curShowing > desiredBlockers.length) {
            this._curShowing--;
            this._curBlockers[this._curShowing].div.style.display = 'none';
        }
    }
}

export {TouchScrollBlocker}
