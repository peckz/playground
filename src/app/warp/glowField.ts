import * as THREE from "three";
import type { GlowPalette } from "./palettes";

/**
 * The glow block's light as a small picture of its middle plane, computed in the browser
 * whenever the palette changes. It is the Blender scene's recipe, step for step:
 *
 * 1. The tracer's colour formula: warm deep inside and low in the block, cooling towards the
 *    outline and the top.
 * 2. A soft blur (smooth_glow.py). The formula measures depth from the nearest edge, and where
 *    the nearest edge switches sides it folds into a crease running in from each corner.
 *    The blur melts those creases and keeps the overall gradient.
 *
 * The shaders then only look the colour up, which is cheaper than working it out per pixel.
 */

/** The area the picture covers, in the icon's units: the glow block's outline and a margin */
export const FIELD_LOW = new THREE.Vector2(-2.5022, -2.55);
export const FIELD_SIZE = new THREE.Vector2(3.9343, 4.58);
/** The blur is wide, so the picture is smooth and stays sharp enough this small */
const RESOLUTION = 128;
/** Blur radius (sigma) in the icon's units, as in smooth_glow.py */
const SOFTNESS = 0.3;

const LEAN = Math.tan(THREE.MathUtils.degToRad(14));
const CORNER = 0.5;
const HALF_THICKNESS = 0.75;
const STRENGTH = 1.3;

function smoothstep(low: number, high: number, value: number) {
  const amount = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

/** How warm each spot is, from 0 at the cool rim to 1 in the heart. The same for any palette. */
function warmthField(planes: THREE.Vector3[]) {
  const warmth = new Float32Array(RESOLUTION * RESOLUTION);
  for (let row = 0; row < RESOLUTION; row += 1) {
    const y = FIELD_LOW.y + ((row + 0.5) / RESOLUTION) * FIELD_SIZE.y;
    for (let column = 0; column < RESOLUTION; column += 1) {
      // Read on the middle plane, where the leaning outline has shifted half its lean
      const x =
        FIELD_LOW.x +
        ((column + 0.5) / RESOLUTION) * FIELD_SIZE.x +
        HALF_THICKNESS * LEAN;
      let deepest = -Infinity;
      let cubes = 0;
      for (const plane of planes) {
        const edge = plane.x * x + plane.y * y - plane.z + CORNER;
        deepest = Math.max(deepest, edge);
        cubes += Math.max(edge, 0) ** 3;
      }
      const outline = Math.cbrt(cubes) + Math.min(deepest, 0) - CORNER;
      const distance =
        Math.max(outline, -HALF_THICKNESS) / Math.sqrt(1 + LEAN * LEAN);
      const depth = Math.min(Math.max(-distance / 0.7, 0), 1);
      const rise = Math.min(Math.max((y + 2.5) / 4.48, 0), 1);
      warmth[row * RESOLUTION + column] = Math.min(
        Math.max(depth * 0.55 + (1 - rise) * 0.75 - 0.1, 0),
        1,
      );
    }
  }
  return warmth;
}

/** One pass of a Gaussian blur along rows or columns, mirroring at the picture's border */
function blurPass(
  source: Float32Array,
  target: Float32Array,
  sigma: number,
  alongRows: boolean,
) {
  const radius = Math.ceil(sigma * 3);
  const weights: number[] = [];
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights.push(weight);
    total += weight;
  }
  for (let row = 0; row < RESOLUTION; row += 1) {
    for (let column = 0; column < RESOLUTION; column += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        let place = (alongRows ? column : row) + offset;
        if (place < 0) {
          place = -place - 1;
        }
        if (place >= RESOLUTION) {
          place = 2 * RESOLUTION - place - 1;
        }
        const index =
          (alongRows ? row * RESOLUTION + place : place * RESOLUTION + column) *
          4;
        const weight = weights[offset + radius];
        red += source[index] * weight;
        green += source[index + 1] * weight;
        blue += source[index + 2] * weight;
      }
      const index = (row * RESOLUTION + column) * 4;
      target[index] = red / total;
      target[index + 1] = green / total;
      target[index + 2] = blue / total;
      target[index + 3] = 1;
    }
  }
}

export function createGlowField(planes: THREE.Vector3[]) {
  const warmth = warmthField(planes);
  const colors = new Float32Array(RESOLUTION * RESOLUTION * 4);
  const scratch = new Float32Array(RESOLUTION * RESOLUTION * 4);
  const pixels = new Uint16Array(RESOLUTION * RESOLUTION * 4);
  const texture = new THREE.DataTexture(
    pixels,
    RESOLUTION,
    RESOLUTION,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  function paint(palette: GlowPalette) {
    const core = new THREE.Color(palette.core);
    const middle = new THREE.Color(palette.mid);
    const edge = new THREE.Color(palette.edge);
    const color = new THREE.Color();
    for (let index = 0; index < warmth.length; index += 1) {
      const warm = warmth[index];
      color.lerpColors(edge, middle, smoothstep(0, 0.4, warm));
      color.lerp(core, smoothstep(0.45, 0.9, warm));
      const brightness = (0.5 + 1.7 * warm * warm) * STRENGTH;
      colors[index * 4] = color.r * brightness;
      colors[index * 4 + 1] = color.g * brightness;
      colors[index * 4 + 2] = color.b * brightness;
    }
    blurPass(colors, scratch, (SOFTNESS / FIELD_SIZE.x) * RESOLUTION, true);
    blurPass(scratch, colors, (SOFTNESS / FIELD_SIZE.y) * RESOLUTION, false);
    for (let index = 0; index < colors.length; index += 1) {
      pixels[index] = THREE.DataUtils.toHalfFloat(colors[index]);
    }
    texture.needsUpdate = true;
  }

  return { texture, paint };
}
