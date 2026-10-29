/**
 * Frame math for the success play: one lap with a checkmark inside it.
 *
 * 1. The lines slide off the right, picking up speed, the first half of a lap.
 * 2. The dot squashes, hops, and lands on the checkmark's corner.
 * 3. On landing both legs shoot out of it and settle. The dot is the stroke's
 *    round cap, so it never swaps for another shape: it just grows legs, and
 *    the stroke thins from the dot's width to the line's as they grow.
 * 4. A hold, then the legs pull back into the dot, the dot glides home, and
 *    the lines draw back in from the left: the second half of the lap.
 *
 * Exits accelerate, entrances start fast and settle, nothing fades.
 * Geometry lives in the 32-unit viewBox of the source icon.
 */

import { clamp, cubicBezier, lerp } from "./motion";
import {
  ARC_PATHS,
  CHECK_HIDDEN,
  DOT,
  type Frame,
  format,
  type Settings,
  type StaggerFrom,
} from "./wifiMotion";

/** The corner the dot lands on, and the leg tips, short then long */
export const CHECK = {
  corner: { x: 14.5, y: 21 },
  legs: ["M14.5 21L10 16.5", "M14.5 21L23 12.5"],
};

export type SuccessSettings = Settings & {
  /** How long the checkmark holds before heading home */
  hold: number;
  /** Scales the squash, the hop height and the stretch in flight */
  bounce: number;
};

/* ---------- Timing, in ms ---------- */

const EXIT_MS = 420;
/** The dot starts squashing to hop onto the checkmark corner */
export const SQUASH_START = 360;
const SQUASH_MS = 90;
const HOP_MS = 250;
/** Hop height above the straight line from the dot to the corner, at bounce 1 */
const HOP_HEIGHT = 6;
/** Squash before take-off at bounce 1: this much wider, this much shorter */
const SQUASH_WIDE = 0.3;
const SQUASH_SHORT = 0.38;
/** Stretch along the flight at bounce 1, strongest leaving the ground */
const TAKEOFF_STRETCH = 0.3;
const LANDING_STRETCH = 0.15;
const BURST_MS = 440;
const BURST_TAU = 85;
/** The long leg trails the short one a touch, like a hand drawing it */
const LONG_LEG_DELAY = 30;
const RETRACT_MS = 260;
const HOME_MS = 420;
const HOME_TAU = 75;
const RETURN_MS = 560;
const RETURN_TAU = 95;

const LAND = SQUASH_START + SQUASH_MS + HOP_MS;
/** When the dot lands on the corner and the checkmark starts drawing */
export const CHECK_DRAW_AT = LAND;
const CHECK_DONE = LAND + LONG_LEG_DELAY + BURST_MS;

function retractStart(settings: SuccessSettings) {
  return CHECK_DONE + settings.hold;
}

function homeStart(settings: SuccessSettings) {
  return retractStart(settings) + RETRACT_MS;
}

/** Arcs start drawing back in as the dot sets off home */
function returnStart(settings: SuccessSettings) {
  return homeStart(settings);
}

export function successMs(settings: SuccessSettings) {
  return (
    returnStart(settings) +
    settings.stagger * (ARC_PATHS.length - 1) +
    RETURN_MS
  );
}

/** Accelerates and cuts at peak speed */
const exit = cubicBezier(0.32, 0, 0.67, 0);
const retract = cubicBezier(0.55, 0, 0.75, 0.3);
const squash = cubicBezier(0.3, 0, 0.2, 1);

/** Full speed at 0, slowing by the same fraction every ms, lands exactly on 1 at `length` */
function settle(time: number, tau: number, length: number) {
  return (
    (1 - Math.exp(-clamp(time, 0, length) / tau)) /
    (1 - Math.exp(-length / tau))
  );
}

function order(index: number, from: StaggerFrom) {
  return from === "top" ? ARC_PATHS.length - 1 - index : index;
}

/** A stretch of the arc from `tail` to `head`, both along 0-1 of it, for `pathLength={1}` */
function stretch(tail: number, head: number) {
  const start = clamp(tail, 0, 1);
  const length = clamp(head, 0, 1) - start;
  if (start <= 0 && length >= 1) {
    return { dasharray: "none", dashoffset: "0", transform: "" };
  }
  // An empty dash still paints its round cap, so park it past the end
  if (length <= 0.001) {
    return { dasharray: "0 2", dashoffset: "-1.5", transform: "" };
  }
  return {
    dasharray: `${format(length)} 2`,
    dashoffset: `${format(-start)}`,
    transform: "",
  };
}

function arcAt(index: number, time: number, settings: SuccessSettings) {
  const delay = settings.stagger * order(index, settings.from);
  const back = time - returnStart(settings) - delay;
  if (back > 0) {
    return stretch(0, settle(back, RETURN_TAU, RETURN_MS));
  }
  return stretch(exit(clamp((time - delay) / EXIT_MS, 0, 1)), 1);
}

/** The dot squashed onto its base, then hopping to the corner */
function dotAt(time: number, settings: SuccessSettings): Frame["dot"] {
  const home = time - homeStart(settings);
  if (home > 0) {
    const progress = settle(home, HOME_TAU, HOME_MS);
    const x = lerp(CHECK.corner.x, DOT.cx, progress);
    const y = lerp(CHECK.corner.y, DOT.cy, progress);
    return {
      transform: `translate(${format(x - DOT.cx)} ${format(y - DOT.cy)})`,
      visible: true,
    };
  }

  const squashTime = time - SQUASH_START;
  if (squashTime <= 0) {
    return { transform: "", visible: true };
  }
  const bounce = settings.bounce;
  if (squashTime < SQUASH_MS) {
    // Anticipation: wider and lower, pinned to its base
    const amount = squash(squashTime / SQUASH_MS) * bounce;
    const base = DOT.cy + DOT.r;
    return {
      transform: `translate(${DOT.cx} ${base}) scale(${format(1 + SQUASH_WIDE * amount)} ${format(1 - SQUASH_SHORT * amount)}) translate(${-DOT.cx} ${-base})`,
      visible: true,
    };
  }

  const hop = (squashTime - SQUASH_MS) / HOP_MS;
  if (hop < 1) {
    // Ballistic: a straight line to the corner plus a parabola on top
    const x = lerp(DOT.cx, CHECK.corner.x, hop);
    const y =
      lerp(DOT.cy, CHECK.corner.y, hop) -
      4 * HOP_HEIGHT * bounce * hop * (1 - hop);
    // Springs out of the squash long and thin, round at the top, a touch
    // long again coming down
    const stretch =
      bounce *
      (hop < 0.45
        ? TAKEOFF_STRETCH * squash(1 - hop / 0.45)
        : hop > 0.6
          ? LANDING_STRETCH * ((hop - 0.6) / 0.4)
          : 0);
    return {
      transform: `translate(${format(x)} ${format(y)}) scale(${format(1 - stretch * 0.6)} ${format(1 + stretch)}) translate(${-DOT.cx} ${-DOT.cy})`,
      visible: true,
    };
  }
  // Landed: the checkmark takes over from here until the dot heads home
  return { transform: "", visible: false };
}

function checkAt(time: number, settings: SuccessSettings): Frame["check"] {
  if (time < LAND || time >= homeStart(settings)) {
    return CHECK_HIDDEN;
  }
  const retractTime = time - retractStart(settings);
  const grown =
    retractTime > 0
      ? 1 - retract(clamp(retractTime / RETRACT_MS, 0, 1))
      : settle(time - LAND, BURST_TAU, BURST_MS);
  const longGrown =
    retractTime > 0
      ? grown
      : settle(time - LAND - LONG_LEG_DELAY, BURST_TAU, BURST_MS);
  return {
    legs: [`${format(grown)} 2`, `${format(longGrown)} 2`],
    // From the dot's diameter down to the line's weight as the legs grow
    width: lerp(DOT.r * 2, 2, grown),
    visible: true,
  };
}

export function successFrameAt(time: number, settings: SuccessSettings): Frame {
  return {
    arcs: ARC_PATHS.map((_path, index) => arcAt(index, time, settings)),
    dot: dotAt(time, settings),
    check: checkAt(time, settings),
  };
}
