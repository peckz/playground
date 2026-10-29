/**
 * The loading hops: while the wifi searches, the dot hops in an even rhythm,
 * crouching first, stretching in flight and squashing on every landing. Each
 * hop is the same height, so it reads as waiting rather than a bounce dying out.
 *
 * Geometry lives in the 32-unit viewBox of the source icon.
 */

import { clamp, cubicBezier } from "./motion";
import { DOT, format } from "./wifiMotion";

export type HopSettings = {
  /** How many hops before the check */
  hops: number;
  /** Height of each hop, in viewBox units */
  hopHeight: number;
};

/* ---------- Timing, in ms ---------- */

/** Hops begin as the wave peaks on the outer arc */
const HOPS_START = 280;
/** Anticipation before the first hop */
const CROUCH_MS = 70;
const CROUCH_SQUASH = 0.2;
const AIR_MS = 300;
/** On the ground between hops, squashing and springing back */
const GROUND_MS = 90;
const GROUND_SQUASH = 0.24;
/** Stretch along the flight, strongest leaving and meeting the ground */
const FLIGHT_STRETCH = 0.15;

const crouch = cubicBezier(0.3, 0, 0.2, 1);

function takeoffAt(hop: number) {
  return HOPS_START + CROUCH_MS + hop * (AIR_MS + GROUND_MS);
}

/** The last hop's landing */
export function landedAt(settings: HopSettings) {
  return takeoffAt(settings.hops - 1) + AIR_MS;
}

/** Squash (positive) or stretch (negative) pinned to the dot's base */
function squashed(cy: number, amount: number) {
  if (Math.abs(amount) < 0.001) {
    return "";
  }
  const base = cy + DOT.r;
  return `translate(${DOT.cx} ${format(base)}) scale(${format(1 + amount * 0.8)} ${format(1 - amount)}) translate(${-DOT.cx} ${format(-base)})`;
}

/** The dot hopping in an even rhythm: where its centre is, and its squash */
export function hopDot(time: number, settings: HopSettings) {
  const rest = { cy: DOT.cy, transform: "" };
  const crouchTime = time - HOPS_START;
  if (crouchTime <= 0) {
    return rest;
  }
  if (crouchTime < CROUCH_MS) {
    return {
      ...rest,
      transform: squashed(
        DOT.cy,
        CROUCH_SQUASH * crouch(crouchTime / CROUCH_MS),
      ),
    };
  }
  const cycle = AIR_MS + GROUND_MS;
  const local = time - takeoffAt(0);
  const hop = Math.min(Math.floor(local / cycle), settings.hops - 1);
  const inHop = local - hop * cycle;
  if (inHop < AIR_MS) {
    // Ballistic: a parabola in linear time
    const progress = inHop / AIR_MS;
    const cy = DOT.cy - 4 * settings.hopHeight * progress * (1 - progress);
    return {
      cy,
      transform: squashed(cy, -FLIGHT_STRETCH * Math.abs(1 - 2 * progress)),
    };
  }
  // On the ground between hops: squash in and spring straight back out
  const ground = clamp((inHop - AIR_MS) / GROUND_MS, 0, 1);
  return {
    ...rest,
    transform: squashed(DOT.cy, GROUND_SQUASH * Math.sin(Math.PI * ground)),
  };
}
