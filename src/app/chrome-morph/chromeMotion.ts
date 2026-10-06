/**
 * Frame-by-frame math for the three dots morphing into the Chrome logo.
 *
 * Every shape is resampled into the same number of points along its outline,
 * so a dot and a blade can be blended point by point. Each piece is split into
 * where it sits (its centroid, which orbits the centre) and what it looks like
 * (points relative to that centroid, which morph from a circle into a blade).
 *
 * The whole move is one gesture: every piece orbits clockwise only, every
 * channel eases out without overshoot, so nothing ever turns back.
 *
 * Geometry lives in the 24-unit viewBox of the source icons.
 */

export type Point = { x: number; y: number };

export type Shape = {
  centroid: Point;
  /** Outline points relative to the centroid, clockwise on screen */
  local: Point[];
};

export type Track = {
  startAngle: number;
  /** Always >= startAngle: pieces only ever orbit clockwise */
  endAngle: number;
  /** Back at the dot one full lap on, > endAngle */
  returnAngle: number;
  startRadius: number;
  endRadius: number;
  dot: Point[];
  /** Blade outline in its final orientation, point order matched to `dot` */
  blade: Point[];
  colorIndex: number;
};

export type PieceFrame = { d: string; mix: number; colorIndex: number };

export type Frame = {
  pieces: PieceFrame[];
  coreRadius: number;
  /** How fast the orbit is moving, in move-progress per play; peaks around 2.5 */
  velocity: number;
};

export type MotionSettings = {
  /** Extra lag on each blade's own rotation, in degrees, caught up by the end */
  twist: number;
  /** Fraction of the play the dots spin as circles before blooming into blades */
  expandAt: number;
};

export const CENTER = 12;
export const CORE_RADIUS = 3;
const SAMPLE_COUNT = 240;

/** dots-vertical-solid.svg, top to bottom */
export const DOT_PATHS = [
  "M10 5C10 3.89543 10.8954 3 12 3C13.1046 3 14 3.89543 14 5C14 6.10457 13.1046 7 12 7C10.8954 7 10 6.10457 10 5Z",
  "M10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12Z",
  "M10 19C10 17.8954 10.8954 17 12 17C13.1046 17 14 17.8954 14 19C14 20.1046 13.1046 21 12 21C10.8954 21 10 20.1046 10 19Z",
];

/** google-chrome-solid.svg blades: top, lower left, lower right. The core is a circle of r 3 */
export const BLADE_PATHS = [
  "M7.3758 10.0948L4.62601 5.48294C4.40582 5.11364 4.29572 4.929 4.27091 4.7166C4.25075 4.54412 4.28692 4.32636 4.36174 4.16966C4.45389 3.97668 4.5973 3.85491 4.88412 3.61137C6.80233 1.98258 9.28642 1 12 1C15.8074 1 19.1629 2.93434 21.1376 5.87389C21.3556 6.19845 21.4646 6.36074 21.455 6.52857C21.4471 6.6665 21.368 6.81497 21.2579 6.89844C21.124 7 20.9137 7 20.4932 7H12C9.9132 7 8.12499 8.2784 7.3758 10.0948Z",
  "M1 12C1 10.3114 1.38049 8.71163 2.06042 7.2818C2.22799 6.92942 2.31178 6.75323 2.46081 6.67585C2.58329 6.61226 2.75115 6.60438 2.87904 6.65623C3.03467 6.71931 3.14217 6.89961 3.35717 7.26021L7.59531 14.3682C8.43952 15.9351 10.0954 17 12 17C12.2053 17 12.4076 16.9876 12.6064 16.9636L9.93148 21.625C9.71771 21.9975 9.61083 22.1838 9.43776 22.3095C9.29737 22.4115 9.08939 22.4868 8.91624 22.4983C8.70278 22.5125 8.52682 22.4472 8.1749 22.3167C3.98549 20.7628 1 16.7301 1 12Z",
  "M11.7268 22.5147C11.6029 22.7306 11.7511 23 12 23C18.0751 23 23 18.0751 23 12C23 11.3802 22.9487 10.7723 22.8502 10.1804C22.7885 9.80989 22.7577 9.62464 22.6392 9.44638C22.543 9.30176 22.3742 9.15872 22.2158 9.08763C22.0205 9 21.8056 9 21.3757 9H16.0004C16.6281 9.83566 17 10.8744 17 12C17 12.9795 16.7183 13.8933 16.2315 14.6647L11.7268 22.5147Z",
];

/* ---------- Easing ---------- */

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

/** CSS cubic-bezier() as a function, solved with Newton steps and a bisection fallback */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
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
    const clamped = clamp(progress, 0, 1);
    let time = clamped;
    for (let step = 0; step < 6; step++) {
      const error = sample(x1, x2, time) - clamped;
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
    time = clamped;
    for (let step = 0; step < 20; step++) {
      if (sample(x1, x2, time) < clamped) {
        low = time;
      } else {
        high = time;
      }
      time = (low + high) / 2;
    }
    return sample(y1, y2, time);
  };
}

/** Snappy: almost no ease-in, then a long exponential-feeling glide. y never passes 1 */
/** One curve for the whole spin: half the turn is done at 35%, the rest is the brake */
const SPIN = cubicBezier(0.35, 0, 0.25, 1);
/** Blooming and folding: fast off the mark, long settle into the spin's stop */
const EXPAND = cubicBezier(0.3, 0, 0.1, 1);
const COLOR_EASE = cubicBezier(0.4, 0, 0.2, 1);

type Channel = {
  start: number;
  end: number;
  ease: (progress: number) => number;
};

type Channels = Record<"move" | "shape" | "color" | "core", Channel>;

/**
 * When each channel runs, as fractions of the play. It's a figure skater: in,
 * the dots spin tight and only open into blades at `expandAt`, so the bloom is
 * what brakes the spin. Back, the arms come in first (core tucks, blades fold)
 * and the dots carry the lap on.
 */
function channelsFor(toLogo: boolean, expandAt: number): Channels {
  if (toLogo) {
    return {
      move: { start: 0, end: 1, ease: SPIN },
      shape: {
        start: expandAt,
        end: Math.min(1, expandAt + 0.6),
        ease: EXPAND,
      },
      color: {
        start: Math.max(0, expandAt - 0.1),
        end: Math.min(1, expandAt + 0.35),
        ease: COLOR_EASE,
      },
      core: { start: Math.min(0.9, expandAt + 0.12), end: 1, ease: EXPAND },
    };
  }
  return {
    move: { start: 0, end: 1, ease: SPIN },
    shape: { start: 0, end: Math.max(0.3, 1 - expandAt), ease: EXPAND },
    color: { start: 0.1, end: Math.max(0.4, 1 - expandAt), ease: COLOR_EASE },
    core: { start: 0, end: 0.4, ease: EXPAND },
  };
}

/** How far toward the logo a channel is, 0 = dots, 1 = logo */
function channelAt(channel: Channel, progress: number, toLogo: boolean) {
  const local = channel.ease(
    (progress - channel.start) / (channel.end - channel.start),
  );
  return toLogo ? local : 1 - local;
}

/* ---------- Geometry ---------- */

const TAU = Math.PI * 2;

function rotatePoint(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function signedArea(points: Point[]) {
  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  });
  return area / 2;
}

function polygonCentroid(points: Point[]): Point {
  const area = signedArea(points);
  let x = 0;
  let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point.x * next.y - next.x * point.y;
    x += (point.x + next.x) * cross;
    y += (point.y + next.y) * cross;
  });
  return { x: x / (6 * area), y: y / (6 * area) };
}

/** Samples an svg path evenly along its length. Needs the DOM, so call it on the client */
export function sampleShape(d: string, count = SAMPLE_COUNT): Shape {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute(
    "style",
    "position:absolute;width:0;height:0;visibility:hidden",
  );
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  document.body.appendChild(svg);
  const length = path.getTotalLength();
  let points = Array.from({ length: count }, (_, index) => {
    const point = path.getPointAtLength((length * index) / count);
    return { x: point.x, y: point.y };
  });
  svg.remove();

  // y points down, so a positive area is clockwise on screen
  if (signedArea(points) < 0) {
    points = points.reverse();
  }
  const centroid = polygonCentroid(points);
  return {
    centroid,
    local: points.map((point) => ({
      x: point.x - centroid.x,
      y: point.y - centroid.y,
    })),
  };
}

/** Rotates the target's point order so each point lands near its partner in the reference */
function alignTo(reference: Point[], target: Point[]) {
  const count = reference.length;
  let bestOffset = 0;
  let bestCost = Infinity;
  for (let offset = 0; offset < count; offset++) {
    let cost = 0;
    for (let index = 0; index < count; index++) {
      const point = target[(index + offset) % count];
      cost +=
        (point.x - reference[index].x) ** 2 +
        (point.y - reference[index].y) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  return reference.map((_, index) => target[(index + bestOffset) % count]);
}

function polar(point: Point) {
  return {
    angle: Math.atan2(point.y - CENTER, point.x - CENTER),
    radius: Math.hypot(point.x - CENTER, point.y - CENTER),
  };
}

/** Clockwise sweep from one angle to another, at least `spin` so every piece turns hard */
function clockwiseSweep(from: number, to: number, spin: number) {
  const base = (((to - from) % TAU) + TAU) % TAU;
  const turns = Math.max(0, Math.ceil((spin - base) / TAU));
  return base + turns * TAU;
}

const PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Pairs each dot with a blade so all of them sweep clockwise by roughly the
 * same `spin` degrees, which makes the three read as one rotating group.
 */
export function buildTracks(dots: Shape[], blades: Shape[], spin: number) {
  const spinRadians = (spin * Math.PI) / 180;
  const dotPolar = dots.map((dot) => polar(dot.centroid));
  const bladePolar = blades.map((blade) => polar(blade.centroid));
  const isOuter = dotPolar.map((dot) => dot.radius > 0.01);

  let bestOrder = PERMUTATIONS[0];
  let bestCost = Infinity;
  PERMUTATIONS.forEach((order) => {
    const cost = order.reduce((sum, bladeIndex, dotIndex) => {
      if (!isOuter[dotIndex]) {
        return sum;
      }
      const sweep = clockwiseSweep(
        dotPolar[dotIndex].angle,
        bladePolar[bladeIndex].angle,
        spinRadians,
      );
      return sum + (sweep - spinRadians) ** 2;
    }, 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestOrder = order;
    }
  });

  const outerSweeps = bestOrder
    .map((bladeIndex, dotIndex) =>
      isOuter[dotIndex]
        ? clockwiseSweep(
            dotPolar[dotIndex].angle,
            bladePolar[bladeIndex].angle,
            spinRadians,
          )
        : null,
    )
    .filter((sweep): sweep is number => sweep !== null);
  const groupSweep =
    outerSweeps.reduce((sum, sweep) => sum + sweep, 0) / outerSweeps.length;

  return dots.map((dot, dotIndex): Track => {
    const bladeIndex = bestOrder[dotIndex];
    const endAngle = bladePolar[bladeIndex].angle;
    // The middle dot has no angle of its own: it swings out with the group
    const sweep = isOuter[dotIndex]
      ? clockwiseSweep(dotPolar[dotIndex].angle, endAngle, spinRadians)
      : groupSweep;
    // The way back keeps going clockwise until the lap is whole. A short
    // leftover would feel limp after the big throw in, so it takes another lap
    let returnSweep = Math.ceil(sweep / TAU) * TAU - sweep;
    if (returnSweep < Math.PI / 2) {
      returnSweep += TAU;
    }
    return {
      startAngle: endAngle - sweep,
      endAngle,
      returnAngle: endAngle + returnSweep,
      startRadius: dotPolar[dotIndex].radius,
      endRadius: bladePolar[bladeIndex].radius,
      dot: dot.local,
      blade: alignTo(dot.local, blades[bladeIndex].local),
      colorIndex: bladeIndex,
    };
  });
}

function toPath(points: Point[]) {
  return (
    "M" +
    points
      .map((point) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
      .join("L") +
    "Z"
  );
}

/** One frame at `progress` (0-1) through the play, toward the logo or back to the dots */
export function frameAt(
  progress: number,
  toLogo: boolean,
  tracks: Track[],
  settings: MotionSettings,
): Frame {
  const channels = channelsFor(toLogo, settings.expandAt);
  // How far along its orbit this play is, 0 -> 1 in either direction
  const travel = channelAt(channels.move, progress, true);
  const shape = channelAt(channels.shape, progress, toLogo);
  const color = channelAt(channels.color, progress, toLogo);
  const core = channelAt(channels.core, progress, toLogo);
  const twistRadians = (settings.twist * Math.PI) / 180;

  const pieces = tracks.map((track): PieceFrame => {
    // Both directions orbit clockwise: in from the dots, then on round the lap
    const angle = toLogo
      ? lerp(track.startAngle, track.endAngle, travel)
      : lerp(track.endAngle, track.returnAngle, travel);
    const radius = toLogo
      ? lerp(track.startRadius, track.endRadius, travel)
      : lerp(track.endRadius, track.startRadius, travel);
    const centre = {
      x: CENTER + radius * Math.cos(angle),
      y: CENTER + radius * Math.sin(angle),
    };
    // Each blade turns with its orbit. Forming, it starts behind and catches
    // up; folding away, it runs ahead, so the twist always adds to the spin
    const lag = twistRadians * (1 - shape);
    const orientation = angle - track.endAngle + (toLogo ? -lag : lag);
    const points = track.dot.map((dotPoint, index) => {
      const blended = {
        x: lerp(dotPoint.x, track.blade[index].x, shape),
        y: lerp(dotPoint.y, track.blade[index].y, shape),
      };
      const rotated = rotatePoint(blended, orientation);
      return { x: centre.x + rotated.x, y: centre.y + rotated.y };
    });
    return { d: toPath(points), mix: color, colorIndex: track.colorIndex };
  });

  const step = 0.005;
  const velocity =
    Math.abs(
      channelAt(channels.move, progress + step, toLogo) -
        channelAt(channels.move, progress - step, toLogo),
    ) /
    (2 * step);

  return { pieces, coreRadius: CORE_RADIUS * core, velocity };
}

/* ---------- Colour ---------- */

function hexToLinear(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    },
  );
}

function linearToOklab(rgb: number[]) {
  const [red, green, blue] = rgb;
  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

function oklabToHex(lab: number[]) {
  const [lightness, greenRed, blueYellow] = lab;
  const long =
    (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const medium =
    (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const short =
    (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  return (
    "#" +
    linear
      .map((channel) => {
        const clamped = clamp(channel, 0, 1);
        const srgb =
          clamped <= 0.0031308
            ? clamped * 12.92
            : 1.055 * clamped ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** Blends two hex colours in OKLab so the midpoint never goes muddy */
export function mixColor(from: string, to: string, amount: number) {
  if (amount <= 0) {
    return from;
  }
  if (amount >= 1) {
    return to;
  }
  const start = linearToOklab(hexToLinear(from));
  const end = linearToOklab(hexToLinear(to));
  return oklabToHex(
    start.map((channel, index) => lerp(channel, end[index], amount)),
  );
}
