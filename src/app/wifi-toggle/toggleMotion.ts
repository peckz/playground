/**
 * Frame math for the wifi toggle's connect play: search, load, then check.
 *
 * 1. The wave runs out through the arcs, once.
 * 2. Loading: the dot hops in an even rhythm, squashing on every landing.
 * 3. During the last hop the lines start their lap out, and the moment the
 *    dot lands it squashes and hops onto the checkmark's corner: the success
 *    play from there, legs shooting out, hold, then everything comes home.
 *
 * Geometry lives in the 32-unit viewBox of the source icon.
 */

import {
  CHECK_DRAW_AT,
  SQUASH_START,
  type SuccessSettings,
  successFrameAt,
  successMs,
} from "./successMotion";
import {
  CHECK_HIDDEN,
  DOT,
  type Frame,
  format,
  fromDot,
  swell,
} from "./wifiMotion";
import { hopDot, landedAt } from "./hopMotion";

export type ToggleSettings = SuccessSettings & {
  /** How many loading hops before the check */
  hops: number;
  /** Height of each loading hop, in viewBox units */
  hopHeight: number;
};

/** The success play's clock, lined up so its squash starts as the last hop lands */
function successStart(settings: ToggleSettings) {
  return landedAt(settings) - SQUASH_START;
}

export function toggleMs(settings: ToggleSettings) {
  return successStart(settings) + successMs(settings);
}

/** The loading hop as a transform on the resting dot */
function hopTransform(time: number, settings: ToggleSettings) {
  const hop = hopDot(time, settings);
  const lift = hop.cy - DOT.cy;
  // Rightmost runs first: lift the dot, then squash it on its own base
  return [hop.transform, lift ? `translate(0 ${format(lift)})` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Pass Infinity when nothing is playing: it reads as finished, at rest */
export function toggleFrameAt(time: number, settings: ToggleSettings): Frame {
  const success = successFrameAt(time - successStart(settings), settings);
  const loading = time < landedAt(settings);
  return {
    arcs: success.arcs.map((arc, index) => ({
      ...arc,
      transform: fromDot(
        1 +
          (settings.arcGrow - 1) *
            swell(time, settings.waveStagger * (index + 1), settings),
      ),
    })),
    dot: loading
      ? { transform: hopTransform(time, settings), visible: true }
      : success.dot,
    check: loading ? CHECK_HIDDEN : success.check,
  };
}

/** Strokes go connected as the lines start their lap, the tile as the check draws */
export function toggleLook(time: number, settings: ToggleSettings) {
  const local = time - successStart(settings);
  return { found: local >= 0, checked: local >= CHECK_DRAW_AT };
}
