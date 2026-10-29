/**
 * Frame math for the wifi icon. Two plays, each a pure function of its own
 * elapsed ms, so they can overlap: the wave runs on hover, the lap on click.
 *
 * Lap: each line rolls through itself left to right, like a loop of line
 * running round a pulley. It slides off the right end while the next turn of
 * the loop comes in from the left and lands where the line started, so the
 * rest frame is the plain icon again.
 *
 * The lap is one move on one curve: a slow start, a fast kick through the
 * middle, then a long settle. The arcs go one after another, from the bottom
 * (inner arc first) or the top (outer arc first), and the dot stays put.
 *
 * Wave: the dot swells, and the swell travels out through the arcs one by
 * one, each growing from the dot and settling back. A swell is one smooth
 * impulse: it leaves at full speed, rounds over its peak, then eases home on
 * a long exponential tail, like something pushed and let go.
 *
 * Geometry lives in the 32-unit viewBox of the source icon.
 */

import { clamp, cubicBezier } from "./motion";

/** Inner to outer */
export const ARC_PATHS = [
  "M11.071 20.0918C13.8047 17.3582 18.2368 17.3582 20.9705 20.0918",
  "M7.53547 16.5566C12.2218 11.8703 19.8197 11.8703 24.506 16.5566",
  "M3.99994 13.0208C10.6388 6.3819 21.4027 6.3819 28.0416 13.0208",
];

export const DOT = { cx: 16, cy: 24, r: 2 };

/** Slow start, fast kick, long settle */
export const EASINGS = {
  kick: [0.65, 0, 0.15, 1],
  soft: [0.45, 0, 0.15, 1],
  snappy: [0.8, 0, 0.1, 1],
} as const;

export type EasingName = keyof typeof EASINGS;

/** Which end the stagger starts from: bottom is the inner arc, top the outer */
export const STAGGER_FROM = ["bottom", "top"] as const;

export type StaggerFrom = (typeof STAGGER_FROM)[number];

export type Settings = {
  /** One arc's lap */
  duration: number;
  /** Delay between one arc and the next */
  stagger: number;
  from: StaggerFrom;
  /** Space between the line leaving and the line coming in, as a fraction of the arc */
  gap: number;
  easing: EasingName;
  /** Peak scale of the dot */
  dotGrow: number;
  /** Peak scale of each arc, from the dot */
  arcGrow: number;
  /** Delay between the dot and the inner arc, and each arc and the next */
  waveStagger: number;
  /** Time from the start of a swell to its peak */
  swellPeak: number;
  /** Whole swell, out and all the way home */
  swellLength: number;
};

export function lapMs(settings: Settings) {
  return settings.duration + settings.stagger * (ARC_PATHS.length - 1);
}

export function waveMs(settings: Settings) {
  return settings.waveStagger * ARC_PATHS.length + settings.swellLength;
}

export type ArcFrame = {
  dasharray: string;
  dashoffset: string;
  /** SVG transform, empty at rest so the icon stays pixel-crisp */
  transform: string;
};

export type Frame = {
  arcs: ArcFrame[];
  dot: { transform: string; visible: boolean };
  /** The success checkmark: each leg's dash, drawn out from its corner */
  check: { legs: string[]; width: number; visible: boolean };
};

export const CHECK_HIDDEN: Frame["check"] = {
  legs: ["0 2", "0 2"],
  width: 2,
  visible: false,
};

/** Scales around the dot's centre */
export function fromDot(scale: number) {
  if (scale === 1) {
    return "";
  }
  return `translate(${DOT.cx} ${DOT.cy}) scale(${format(scale)}) translate(${-DOT.cx} ${-DOT.cy})`;
}

/** Critically damped impulse: 1 at `peak`, full speed at 0, exponential tail */
function impulse(time: number, peak: number) {
  const ratio = time / peak;
  return ratio * Math.exp(1 - ratio);
}

/** 0 to 1 and back to 0 over one swell starting at `start` */
export function swell(time: number, start: number, settings: Settings) {
  const local = time - start;
  const length = settings.swellLength;
  if (local <= 0 || local >= length) {
    return 0;
  }
  // The tail never quite reaches 0, so lean it down to land exactly on it
  const leftover = impulse(length, settings.swellPeak);
  return impulse(local, settings.swellPeak) - leftover * (local / length);
}

export function format(value: number) {
  return Math.round(value * 1000) / 1000;
}

const easingCache = new Map<EasingName, (progress: number) => number>();

function easingFor(name: EasingName) {
  let ease = easingCache.get(name);
  if (!ease) {
    const [x1, y1, x2, y2] = EASINGS[name];
    ease = cubicBezier(x1, y1, x2, y2);
    easingCache.set(name, ease);
  }
  return ease;
}

/**
 * The line and the gap behind it repeat along the arc (`pathLength={1}`).
 * Shifting the pattern by one line plus one gap brings the next line to
 * exactly where the first one started.
 */
function lapArc(progress: number, gap: number) {
  if (progress <= 0 || progress >= 1) {
    return { dasharray: "none", dashoffset: "0" };
  }
  return {
    dasharray: `1 ${format(gap)}`,
    dashoffset: `${format(-progress * (1 + gap))}`,
  };
}

/** Pass Infinity for a play that isn't running: it reads as finished, at rest */
export function frameAt(
  lapTime: number,
  waveTime: number,
  settings: Settings,
): Frame {
  const ease = easingFor(settings.easing);
  return {
    arcs: ARC_PATHS.map((_path, index) => {
      const order =
        settings.from === "top" ? ARC_PATHS.length - 1 - index : index;
      const time = lapTime - settings.stagger * order;
      const grow = swell(
        waveTime,
        settings.waveStagger * (index + 1),
        settings,
      );
      return {
        ...lapArc(ease(clamp(time / settings.duration, 0, 1)), settings.gap),
        transform: fromDot(1 + (settings.arcGrow - 1) * grow),
      };
    }),
    dot: {
      transform: fromDot(
        1 + (settings.dotGrow - 1) * swell(waveTime, 0, settings),
      ),
      visible: true,
    },
    check: CHECK_HIDDEN,
  };
}
