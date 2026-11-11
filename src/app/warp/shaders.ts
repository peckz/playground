/**
 * The glow icon's light, computed per pixel. These are the path tracer's own formulas
 * (shapes, glow colour, output curve) with its many random bounces replaced by one short,
 * exact answer each, which is what makes them fast enough to run every frame:
 *
 * - the glow: a walk of a few steps along the view ray, bent into the block, adding up the
 *   light the block gives off along the way
 * - shadows: the block outlines slid along the sun's direction, blurred more the higher the
 *   edge that casts them
 * - the glow on the plate: the glow's colour at the nearest spot of the block, fading with
 *   distance
 *
 * Everything is in the icon's own space: x right, y up, z out of the plate, 1 unit = 100px.
 */

/** Shapes, glow colour and the output curve, shared by every surface */
export const COMMON = /* glsl */ `
uniform vec3 uGlowPlanes[4];
uniform vec3 uClearPlanes[4];
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform sampler2D uGlowField;
uniform vec2 uFieldLow;
uniform vec2 uFieldSize;
/** Towards the sun and the eye, in the icon's space, so both follow the tilt */
uniform vec3 uSun;
uniform vec3 uEye;

const float LEAN = 0.24932800284; // tan 14 degrees: each step back shifts the outline left
const float GLOW_BACK = 0.25;
const float GLOW_FRONT = 1.75;
const float GLOW_CORNER = 0.5;
const float CLEAR_BACK = 2.8;
const float CLEAR_FRONT = 4.4;
const float CLEAR_CORNER = 0.62;
const float PLATE_HALF = 4.12;

/** A rounded maximum: the outside corner it makes has no crease for a reflection to break on */
float softCombine(vec4 values) {
  float deepest = max(max(values.x, values.y), max(values.z, values.w));
  vec4 outside = max(values, 0.0);
  return pow(dot(outside * outside, outside), 1.0 / 3.0) + min(deepest, 0.0);
}

/** Distance to a block's outline, negative inside, for a point on the block's front face */
float outline(vec3 planes[4], float corner, vec2 point) {
  vec4 distances = vec4(
    dot(planes[0].xy, point) - planes[0].z,
    dot(planes[1].xy, point) - planes[1].z,
    dot(planes[2].xy, point) - planes[2].z,
    dot(planes[3].xy, point) - planes[3].z
  );
  return softCombine(distances + corner) - corner;
}

float glowOutline(vec3 point) {
  return outline(uGlowPlanes, GLOW_CORNER, vec2(point.x - (point.z - GLOW_FRONT) * LEAN, point.y));
}

float clearOutline(vec3 point) {
  return outline(uClearPlanes, CLEAR_CORNER, vec2(point.x - (point.z - CLEAR_FRONT) * LEAN, point.y));
}

float plateOutline(vec2 point) {
  vec2 size = abs(point);
  vec2 squared = size * size;
  return pow(dot(squared * squared, size), 0.2) - PLATE_HALF;
}

/**
 * The light the glow block gives off at a spot, read on its middle plane: warm deep inside
 * and low in the block, cooling towards the outline and the top. Looked up from a small
 * picture that glowField.ts computes and softens for the palette.
 */
vec3 glowAt(vec2 spot) {
  return texture2D(uGlowField, (spot - uFieldLow) / uFieldSize).rgb;
}

/** The render's output curve: exposure, contrast and a shoulder on the brightest channel, which keeps the hue */
vec3 finish(vec3 color) {
  color *= 0.6;
  float peak = max(max(color.r, color.g), max(color.b, 1e-6));
  color *= 0.18 * pow(peak / 0.18, 1.2) / peak;
  peak = max(max(color.r, color.g), max(color.b, 1e-6));
  float over = max(peak - 0.85, 0.0);
  if (over > 0.0) {
    color *= (0.85 + 0.15 * over / (over + 0.15)) / peak;
  }
  return color;
}

/**
 * How much sun reaches a point past one block: 1 in the open, the block's own dimming in
 * its shadow. The outline is tested where the ray to the sun crosses three heights of the
 * block, and each edge blurs by how far above the point it is.
 */
float sunPast(int block, vec3 point, float spread) {
  float back = block == 0 ? GLOW_BACK : CLEAR_BACK;
  float front = block == 0 ? GLOW_FRONT : CLEAR_FRONT;
  float open = 1.0;
  for (int level = 0; level < 3; level += 1) {
    float height = mix(back, front, float(level) * 0.5);
    float reach = (height - point.z) / uSun.z;
    if (reach <= 0.0) {
      continue;
    }
    vec3 above = point + uSun * reach;
    float gap = block == 0 ? glowOutline(above) : clearOutline(above);
    float blur = max(spread * reach, 0.03);
    open = min(open, smoothstep(-blur, blur, gap));
  }
  // The blocks let most of the sun through, the clear one nearly all of it
  return mix(block == 0 ? 0.6 : 0.86, 1.0, open);
}
`;

/** Declares what the surface shaders read, and fills it in per corner of the mesh */
export const VERTEX_PARS = /* glsl */ `
varying vec3 vIconPosition;
varying vec3 vIconNormal;
`;

export const VERTEX_MAIN = /* glsl */ `
vIconPosition = position;
vIconNormal = normal;
`;

/** The glow block: light added up along the view ray as it crosses the block */
export const GLOW_PARS = /* glsl */ `
varying vec3 vIconPosition;
varying vec3 vIconNormal;
${COMMON}

const int GLOW_STEPS = 6;
/** How fast the block swallows its own light with depth */
const float GLOW_DENSITY = 0.5;
const float GLOW_BRIGHTNESS = 0.7;
const float GLOW_MILKINESS = 0.09;

/** How deep inside the glow block a spot is: its distance to the nearest face, wall or back */
float insideGlow(vec3 spot) {
  return min(-glowOutline(spot), min(spot.z - GLOW_BACK, GLOW_FRONT - spot.z));
}

vec3 glowBlock() {
  vec3 normal = normalize(vIconNormal);
  vec3 view = normalize(vIconPosition - uEye);
  // Acrylic bends the ray on its way in, so the glow sits inside the block, not on its skin
  vec3 ray = refract(view, normal, 1.0 / 1.49);

  // First find where the ray leaves the block again: each stride is as long as the spot is
  // deep, so it can't overshoot, and closes in on the far side
  float exit = 0.04;
  for (int stride = 0; stride < 10; stride += 1) {
    float depth = insideGlow(vIconPosition + ray * exit);
    if (depth < 0.004) {
      break;
    }
    exit += depth;
  }

  // Then add up the light along that stretch. The steps scale with its length, so their
  // spots slide smoothly across the block and leave no rings.
  vec3 light = vec3(0.0);
  float stepLength = exit / float(GLOW_STEPS);
  for (int index = 0; index < GLOW_STEPS; index += 1) {
    float travelled = (float(index) + 0.5) * stepLength;
    vec3 spot = vIconPosition + ray * travelled;
    light += glowAt(spot.xy) * exp(-GLOW_DENSITY * travelled);
  }
  light *= GLOW_BRIGHTNESS * stepLength;
  // The block is faintly milky: light scattered around inside lifts every part of it a
  // little, which keeps the cool rim from going dark
  light += (uCore + uMid + uEdge) * (GLOW_MILKINESS / 3.0) * min(exit, 1.5);
  // The walls read a touch darker and pick up a faint grey sheen, as in the render
  float wall = 1.0 - abs(normal.z);
  wall *= wall;
  light = light * (1.0 - 0.3 * wall) + vec3(0.129, 0.126, 0.131) * wall;
  return finish(light);
}
`;

/** The plate: sunlight with the blocks' soft shadows, plus the glow pooling around its block */
export const PLATE_PARS = /* glsl */ `
varying vec3 vIconPosition;
varying vec3 vIconNormal;
${COMMON}

const vec3 PLATE_COLOR = vec3(0.0086, 0.0075, 0.0123);
/** The room and the plate's own soft sheen, which no shadow takes away */
const vec3 PLATE_FILL = vec3(0.018, 0.011, 0.019);
const float SUN_STRENGTH = 3.0;
/** Half the sun's apparent size as the plate sees it, as a slope: a soft 6 degrees */
const float SUN_SPREAD = 0.105;
const float SPILL_STRENGTH = 0.02;
const float SPILL_REACH = 0.9;

vec3 plate() {
  vec3 normal = normalize(vIconNormal);
  vec3 point = vIconPosition;
  float sun = max(dot(normal, uSun), 0.0) * sunPast(0, point, SUN_SPREAD) * sunPast(1, point, SUN_SPREAD);
  vec3 light = PLATE_COLOR * SUN_STRENGTH * sun + PLATE_FILL;

  // The glow reaches the plate from the nearest spot of its block, and fades with distance
  vec3 foot = vec3(point.xy, GLOW_BACK);
  float gap = glowOutline(foot);
  vec2 away = vec2(
    glowOutline(foot + vec3(0.02, 0.0, 0.0)) - gap,
    glowOutline(foot + vec3(0.0, 0.02, 0.0)) - gap
  );
  away /= max(length(away), 1e-5);
  vec2 nearest = point.xy - away * (max(gap, 0.0) + 0.45);
  // Shift from the block's foot to its middle plane, where the glow is read
  nearest.x += 0.75 * LEAN;
  float reach = exp(-max(gap, 0.0) / SPILL_REACH);
  // Right under the block there is only the thin gap to light the plate
  float under = mix(0.55, 1.0, smoothstep(-0.5, 0.0, gap));
  light += glowAt(nearest) * SPILL_STRENGTH * reach * under * max(normal.z, 0.0);
  return finish(light);
}
`;

/** The page behind the icon: flat sunlight and the plate's soft shadow */
export const PAGE_VERTEX = /* glsl */ `
varying vec3 vPagePosition;
void main() {
  vPagePosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPagePosition, 1.0);
}
`;

export const PAGE_FRAGMENT = /* glsl */ `
varying vec3 vPagePosition;
/** Towards the sun in the page's own space: the page doesn't tilt */
uniform vec3 uPageSun;
#include <common>
#include <dithering_pars_fragment>
${COMMON}

const vec3 PAGE_COLOR = vec3(0.0021, 0.0015, 0.0033);
/** The page sees a softer sun than the plate does: 8 degrees */
const float PAGE_SUN_SPREAD = 0.14;

void main() {
  float open = 1.0;
  for (int level = 0; level < 3; level += 1) {
    float height = -0.8 + 0.4 * float(level);
    float reach = (height - vPagePosition.z) / uPageSun.z;
    vec3 above = vPagePosition + uPageSun * reach;
    float blur = PAGE_SUN_SPREAD * reach;
    open = min(open, smoothstep(-blur, blur, plateOutline(above.xy)));
  }
  vec3 light = PAGE_COLOR * 3.0 * uPageSun.z * open;
  gl_FragColor = vec4(finish(light), 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

/**
 * How frosted glass reads what is behind it. three.js blurs by picking one smaller, coarser
 * copy of the picture behind, which turns blocky and makes lines step as the icon moves.
 * This spreads twenty readings over a disc instead, like real frost scattering the light,
 * each from a copy only slightly coarser than the screen. Polished glass keeps three's path.
 */
export const FROST_SAMPLE_BEFORE = /* glsl */ `return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );`;

export const FROST_SAMPLE_AFTER = /* glsl */ `
		if ( lod < 1.0 ) {
			return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
		}
		const int FROST_TAPS = 20;
		float fine = max( lod - 2.5, 0.0 );
		vec2 reach = exp2( lod ) * 0.6 / transmissionSamplerSize;
		vec4 gathered = vec4( 0.0 );
		for ( int tap = 0; tap < FROST_TAPS; tap += 1 ) {
			// A sunflower spiral: even cover of the disc with no rows or rings to show through
			float turn = float( tap ) * 2.39996323;
			float distance = sqrt( ( float( tap ) + 0.5 ) / float( FROST_TAPS ) );
			vec2 aside = vec2( cos( turn ), sin( turn ) ) * distance * reach;
			gathered += textureLod( transmissionSamplerMap, fragCoord.xy + aside, fine );
		}
		return gathered / float( FROST_TAPS );
`;
