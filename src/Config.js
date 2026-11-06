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
 * Configuration parameters for quantum circuit visualizer.
 */
class Config {}

Config.EMPTY_CIRCUIT_TITLE = 'Quirk: Quantum Circuit Simulator';

// Each qubit (when actually used) doubles the cost of simulating each gate applied to the circuit.
// Also each qubit tends to increase the amount of accuracy required.
// I see obvious errors when I set this to 20, and things get pretty laggy past 16.
// Beware setting it too high.
Config.MAX_WIRE_COUNT = 16;
// Rows the editor allows: qubits (at most MAX_WIRE_COUNT) plus QND record-bit wires, which are simulated
// classically and don't count as qubits. Kept below 31 so per-wire bitmasks stay valid ints.
Config.MAX_ROW_COUNT = 30;
Config.SIMPLE_SUPERPOSITION_DRAWING_WIRE_THRESHOLD = 14;

Config.MIN_WIRE_COUNT = 2;
Config.MIN_COL_COUNT = 5;
Config.URL_CIRCUIT_PARAM_KEY = 'circuit';

// Main ink color for strokes, text and markers (near-black).
Config.FOREGROUND_COLOR = '#22252b';

// Gate background colors.
Config.GATE_FILL_COLOR = '#ffffff';
Config.HIGHLIGHTED_GATE_FILL_COLOR = '#ffd9b8';
Config.TIME_DEPENDENT_HIGHLIGHT_COLOR = '#fff4cf';

// Mixed-state displays are green.
Config.DISPLAY_GATE_IN_TOOLBOX_FILL_COLOR = '#e6e8ec';
Config.DISPLAY_GATE_BACK_COLOR = '#f6f7f9';
Config.DISPLAY_GATE_FORE_COLOR = '#c4cbd7';

// Changes are yellow.
Config.OPERATION_BACK_COLOR = '#fffaeb';
Config.OPERATION_FORE_COLOR = '#f5c44f';

// Pure-state displays are cyan.
Config.SUPERPOSITION_BACK_COLOR = '#eef5fd';
Config.SUPERPOSITION_MID_COLOR = '#a8cbf5';
Config.SUPERPOSITION_FORE_COLOR = '#2a78d6';

// Time constants.
Config.CYCLE_DURATION_MS = 8000; // How long it takes for evolving gates to cycle, in milliseconds.
Config.TIME_CACHE_GRANULARITY = 196; // The number of buckets the cycle is divided into.
Config.REDRAW_COOLDOWN_MILLIS = 10; // Milliseconds. Rate-limit on redraws. Long draws pad this limit.

/** Half of the span of a drawn gate, width-wise and height-wise.
* @type {!number} */
Config.GATE_RADIUS = 20;
Config.WIRE_SPACING = 50;

Config.BACKGROUND_COLOR = '#ffffff';
Config.BACKGROUND_COLOR_CIRCUIT = '#ffffff';

// Toolbox layout.
Config.BACKGROUND_COLOR_TOOLBOX = '#f3f2ee';
Config.TOOLBOX_GATE_SPACING = 2;
Config.TOOLBOX_GROUP_SPACING = 24 - Config.TOOLBOX_GATE_SPACING;
Config.TOOLBOX_GATE_SPAN = Config.GATE_RADIUS * 2 + Config.TOOLBOX_GATE_SPACING;
Config.TOOLBOX_GROUP_SPAN = Config.TOOLBOX_GATE_SPAN * 2 + Config.TOOLBOX_GROUP_SPACING;
Config.TOOLBOX_MARGIN_X = 35;
Config.TOOLBOX_MARGIN_Y = 18;

/**
 * Some tooltips end up looking terrible without available vertical space.
 * (e.g. the error box might not fit, or the gate tips might get squashed)
 * @type {number}
 */
Config.MINIMUM_CANVAS_HEIGHT = 400;

Config.SUPPRESSED_GLSL_WARNING_PATTERNS = [];

// Draw constants.
Config.DEFAULT_FILL_COLOR = '#ffffff';
Config.DEFAULT_STROKE_COLOR = Config.FOREGROUND_COLOR;
Config.DEFAULT_TEXT_COLOR = Config.FOREGROUND_COLOR;
Config.DEFAULT_FONT_SIZE = 12;
Config.DEFAULT_FONT_FAMILY = 'QndMath, Inter, system-ui, -apple-system, sans-serif';
Config.DEFAULT_STROKE_THICKNESS = 1;

// Calling WebGLRenderingContext.getError forces a CPU/GPU sync. It's very expensive.
Config.CHECK_WEB_GL_ERRORS_EVEN_ON_HOT_PATHS = false;
Config.SEMI_STABLE_RANDOM_VALUE_LIFETIME_MILLIS = 300;

Config.IGNORED_WEBGL_INFO_TERMS = [];

// QND fork styling.
Config.GATE_CORNER_RADIUS = 6;
Config.GATE_OUTLINE_COLOR = '#2b2f36';
Config.MUTED_TEXT_COLOR = '#6b6f76';
Config.PARITY_LABEL_COLOR = '#c2410c';
Config.GATE_HIGHLIGHT_OUTLINE_COLOR = '#e07b28';
Config.TOOLBOX_GATE_SHADOW_COLOR = 'rgba(20, 24, 31, 0.10)';
// Serif stack for paper-style math labels (M_{Z⊗k}, c₀, X^{cₖ}); QndMath supplies the ⊗ ⊕ glyphs.
Config.MATH_FONT_FAMILY = "QndMath, 'STIX Two Math', 'Cambria Math', 'Times New Roman', Georgia, serif";

// QND gates and checks.
Config.QND_ACCENT_COLOR = '#0f8a6c';      // QND readout gate, Z input tabs, outcome arrows.
Config.QND_FILL_COLOR = '#e3f4ee';        // QND readout gate background.
Config.QND_X_TAB_COLOR = '#4f46c8';       // X input tabs.
Config.QND_TAB_TEXT_COLOR = '#ffffff';
Config.QND_CONSUMED_WIRE_COLOR = '#9a9ca1';  // Dashed wire after a single-qubit readout consumed it.

// Classical record view.
Config.RECORD_COLOR = '#b36b00';          // Record entries c_k picked by hand.
Config.RECORD_BAD_COLOR = '#c0392b';      // Record references that aren't available at that point.
Config.CLASSICAL_WIRE_COLOR = '#a9a7a0';
Config.CLASSICAL_WIRE_LABEL_COLOR = '#8a8984';

// Secondary drawing colors (borders, grid lines, tooltips).
Config.BORDER_COLOR = 'lightgray';            // Display borders and grids.
Config.FAINT_LINE_COLOR = '#BBB';             // Bloch sphere and amplitude guide lines.
Config.INPUT_GATE_FILL_COLOR = '#DDD';
Config.SECONDARY_FILL_COLOR = '#F3F3F3';      // Location-independent and permutation gate backgrounds.
Config.DISPLAY_OUTLINE_COLOR = '#040';        // Density matrix probability marks.
Config.SHADE_RGB = '0, 0, 0';                 // Base of translucent indicator overlays (rgba).
Config.TOOLTIP_BACK_COLOR = '#F9FFF9';
Config.TOOLTIP_TITLE_COLOR = 'blue';

/** How much the circuit canvas is zoomed (below 1 on phones); pointer positions are divided by it. */
Config.CANVAS_SCALE = 1;

/** Seconds between new samples of QND readouts and resets (instead of every frame, which kept the CPU busy). */
Config.QND_RESAMPLE_SECONDS = 0.4;

/** Dark theme values for the colors above; Config.setDarkTheme swaps them in. */
Config.DARK_THEME_COLORS = {
    FOREGROUND_COLOR: '#dfe1e5',
    DEFAULT_STROKE_COLOR: '#dfe1e5',
    DEFAULT_TEXT_COLOR: '#dfe1e5',
    DEFAULT_FILL_COLOR: '#2b2d30',
    GATE_FILL_COLOR: '#2b2d30',
    HIGHLIGHTED_GATE_FILL_COLOR: '#4a3b26',
    TIME_DEPENDENT_HIGHLIGHT_COLOR: '#33301f',
    DISPLAY_GATE_IN_TOOLBOX_FILL_COLOR: '#303237',
    DISPLAY_GATE_BACK_COLOR: '#232529',
    DISPLAY_GATE_FORE_COLOR: '#43474e',
    OPERATION_BACK_COLOR: '#2f2b1f',
    OPERATION_FORE_COLOR: '#d9a93e',
    SUPERPOSITION_BACK_COLOR: '#1f2530',
    SUPERPOSITION_MID_COLOR: '#2e4a6a',
    SUPERPOSITION_FORE_COLOR: '#58a6ff',
    BACKGROUND_COLOR: '#1e1f22',
    BACKGROUND_COLOR_CIRCUIT: '#1e1f22',
    BACKGROUND_COLOR_TOOLBOX: '#232427',
    GATE_OUTLINE_COLOR: '#9a9da3',
    MUTED_TEXT_COLOR: '#8a8d93',
    PARITY_LABEL_COLOR: '#ff9a6b',
    GATE_HIGHLIGHT_OUTLINE_COLOR: '#f2a65a',
    TOOLBOX_GATE_SHADOW_COLOR: 'rgba(0, 0, 0, 0.5)',
    QND_ACCENT_COLOR: '#3fd0a4',
    QND_FILL_COLOR: '#173a32',
    QND_X_TAB_COLOR: '#9a8cff',
    QND_TAB_TEXT_COLOR: '#1e1f22',
    QND_CONSUMED_WIRE_COLOR: '#606369',
    RECORD_COLOR: '#f0b34a',
    RECORD_BAD_COLOR: '#ff7b72',
    CLASSICAL_WIRE_COLOR: '#4f5258',
    CLASSICAL_WIRE_LABEL_COLOR: '#8a8d93',
    BORDER_COLOR: '#393b40',
    FAINT_LINE_COLOR: '#45484d',
    INPUT_GATE_FILL_COLOR: '#35373b',
    SECONDARY_FILL_COLOR: '#28292c',
    DISPLAY_OUTLINE_COLOR: '#7ee2a8',
    SHADE_RGB: '255, 255, 255',
    TOOLTIP_BACK_COLOR: '#24262a',
    TOOLTIP_TITLE_COLOR: '#8ab4f8',
};
const LIGHT_THEME_COLORS = {};
for (let key of Object.keys(Config.DARK_THEME_COLORS)) {
    LIGHT_THEME_COLORS[key] = Config[key];
}
Config.isDarkTheme = false;
/**
 * Switches every themed color at once. Drawing code reads Config at paint time, so a redraw shows the new theme.
 * @param {!boolean} dark
 */
Config.setDarkTheme = dark => {
    Object.assign(Config, dark ? Config.DARK_THEME_COLORS : LIGHT_THEME_COLORS);
    Config.isDarkTheme = dark;
};

export {Config}
