/**
 * Easing and small math shared by the playground icons. Every icon animation
 * is a pure function of its progress (0-100 along one play), so these are the
 * only moving parts: curves in, numbers out.
 */

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

export function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function easeInOutSine(progress: number) {
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

export function smoothstep(progress: number) {
  const clamped = clamp(progress, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - clamp(progress, 0, 1), 3);
}

export function easeInCubic(progress: number) {
  return Math.pow(clamp(progress, 0, 1), 3);
}

/** Overshoots past 1 and comes back; `overshoot` 1.7 is the CSS back curve */
export function easeOutBack(progress: number, overshoot = 1.70158) {
  const shifted = clamp(progress, 0, 1) - 1;
  return (
    1 +
    (overshoot + 1) * shifted * shifted * shifted +
    overshoot * shifted * shifted
  );
}

/** CSS cubic-bezier() as a function, solved with Newton steps and a bisection fallback */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  function sample(a1: number, a2: number, time: number) {
    return (
      3 * a1 * time * (1 - time) ** 2 +
      3 * a2 * time ** 2 * (1 - time) +
      time ** 3
    );
  }
  function slope(a1: number, a2: number, time: number) {
    return (
      3 * a1 * (1 - time) ** 2 +
      6 * (a2 - a1) * time * (1 - time) +
      3 * (1 - a2) * time ** 2
    );
  }
  return function ease(progress: number) {
    let time = progress;
    for (let step = 0; step < 6; step++) {
      const error = sample(x1, x2, time) - progress;
      const derivative = slope(x1, x2, time);
      if (Math.abs(error) < 1e-5) {
        return sample(y1, y2, time);
      }
      if (Math.abs(derivative) < 1e-6) {
        break;
      }
      time -= error / derivative;
    }
    let low = 0;
    let high = 1;
    time = progress;
    for (let step = 0; step < 20; step++) {
      if (sample(x1, x2, time) < progress) {
        low = time;
      } else {
        high = time;
      }
      time = (low + high) / 2;
    }
    return sample(y1, y2, time);
  };
}

/** Quick off the mark, long decelerate: a thing being thrown or yanked */
export const LAUNCH = cubicBezier(0.2, 0.7, 0.4, 1);
/** Gathers speed and arrives still moving, for a hit at the end */
export const FALL = cubicBezier(0.5, 0, 0.8, 0.4);
/** Plain ease-out for coming to rest */
export const SETTLE = cubicBezier(0, 0, 0.58, 1);

/**
 * A damped sine that starts at 0, swings to `amplitude`, and dies out: the
 * universal "something got hit" curve. `elapsed` and `period` share a unit.
 */
export function ring(
  elapsed: number,
  amplitude: number,
  period: number,
  decay: number,
) {
  if (elapsed <= 0) {
    return 0;
  }
  return (
    amplitude *
    Math.exp(-elapsed / decay) *
    Math.sin((Math.PI * elapsed) / (period / 2))
  );
}

export type Key<Values> = Values & {
  at: number;
  /** Curve from this key to the next */
  ease: (progress: number) => number;
};

/** Interpolates every numeric field between the keys around `at` */
export function keyedAt<Values extends Record<string, number>>(
  keys: Key<Values>[],
  at: number,
): Values {
  for (let index = 0; index < keys.length - 1; index++) {
    const from = keys[index];
    const to = keys[index + 1];
    if (at >= from.at && at <= to.at) {
      const progress = from.ease((at - from.at) / (to.at - from.at));
      const result = {} as Record<string, number>;
      Object.keys(from).forEach((name) => {
        if (name !== "at" && name !== "ease") {
          result[name] = lerp(from[name], to[name], progress);
        }
      });
      return result as Values;
    }
  }
  const last = at > keys[keys.length - 1].at ? keys[keys.length - 1] : keys[0];
  const result = {} as Record<string, number>;
  Object.keys(last).forEach((name) => {
    if (name !== "at" && name !== "ease") {
      result[name] = last[name] as number;
    }
  });
  return result as Values;
}
