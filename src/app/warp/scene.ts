import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createGlowField, FIELD_LOW, FIELD_SIZE } from "./glowField";
import type { GlowPalette } from "./palettes";
import {
  FROST_SAMPLE_AFTER,
  FROST_SAMPLE_BEFORE,
  GLOW_PARS,
  PAGE_FRAGMENT,
  PAGE_VERTEX,
  PLATE_PARS,
  VERTEX_MAIN,
  VERTEX_PARS,
} from "./shaders";

/**
 * The glow icon in real time, with no pre-rendered pictures: only the three meshes come
 * from the Blender scene. The glow, the sunlight, the shadows and the glow pooling on the
 * plate are computed per pixel (shaders.ts), the clear block is three.js's own glass, and
 * the softbox highlights along the edges come from a small studio painted at start-up.
 *
 * Axes are Blender's: x right, y up, z towards the viewer. 1 unit is 100px of the 1024 icon.
 */

const ASSETS = "/warp";
const ICON_SIZE = 8.24;
/** A long lens, like the render: thickness shows through tilt, not through keystoning */
const LENS_FOV = 8;
/** The icon's share of the window's short side */
const ICON_SHARE = 0.46;
const MAX_PIXEL_RATIO = 2;

/** How far the icon leans towards the cursor at the window's edge, in degrees */
const MAX_TILT = 12;
/** Time for the tilt to cover about two thirds of the way to the cursor, in seconds */
const TILT_SETTLE = 0.06;
const REST_EPSILON = 0.00002;

/** The two blocks' outlines on the 1024px icon, clockwise from the top left */
const GLOW_OUTLINE: [number, number][] = [
  [302, 314],
  [662, 314],
  [532, 762],
  [302, 762],
];
const CLEAR_OUTLINE: [number, number][] = [
  [502, 262],
  [762, 262],
  [762, 710],
  [372, 710],
];
const PAGE_Z = -1.12;
/** Where the sun stands: upper left, 50 degrees up */
const SUN = new THREE.Vector3(-0.413, 0.492, 0.766).normalize();

/** Each edge of an outline as a line: its outward direction, and how far out it sits */
function edgePlanes(outlinePixels: [number, number][]) {
  const corners = outlinePixels.map(
    ([x, y]) => new THREE.Vector2((x - 512) / 100, (512 - y) / 100),
  );
  const center = corners
    .reduce((sum, corner) => sum.add(corner), new THREE.Vector2())
    .divideScalar(corners.length);
  return corners.map((corner, index) => {
    const following = corners[(index + 1) % corners.length];
    const along = following.clone().sub(corner).normalize();
    const outward = new THREE.Vector2(along.y, -along.x);
    if (outward.dot(corner.clone().sub(center)) < 0) {
      outward.negate();
    }
    return new THREE.Vector3(outward.x, outward.y, outward.dot(corner));
  });
}

type Softbox = {
  direction: [number, number, number];
  /** Full brightness inside this angle from the direction, fading out to the outer angle */
  inner: number;
  outer: number;
  radiance: [number, number, number];
};

/**
 * The studio from premium_look.py, as directions only: key, cool rim, violet accent.
 * They sit low and stay narrow. A flat face mirrors the direction twice its tilt away from
 * straight up, at most about 34 degrees, and no softbox reaches in that far. So only the
 * rounded edges ever catch one, as a thin line, and a face never fills with white.
 */
const SOFTBOXES: Softbox[] = [
  {
    direction: [-0.568, 0.676, 0.469],
    inner: 6,
    outer: 18,
    radiance: [8.0, 7.85, 7.65],
  },
  {
    direction: [0.6, -0.7, 0.45],
    inner: 8,
    outer: 22,
    radiance: [1.15, 1.3, 1.6],
  },
  {
    direction: [0.75, -0.55, 0.35],
    inner: 10,
    outer: 26,
    radiance: [0.17, 0.07, 0.6],
  },
];
const ROOM_RADIANCE: [number, number, number] = [0.027, 0.021, 0.054];

function smoothstep(low: number, high: number, value: number) {
  const amount = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

/** The softboxes painted into a small equirectangular map, for reflections */
function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const width = 256;
  const height = 128;
  const pixels = new Float32Array(width * height * 4);
  const boxes = SOFTBOXES.map((softbox) => ({
    ...softbox,
    axis: new THREE.Vector3(...softbox.direction).normalize(),
  }));
  const direction = new THREE.Vector3();
  for (let row = 0; row < height; row += 1) {
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let column = 0; column < width; column += 1) {
      const longitude = ((column + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
      const overhead = 0.75 + 0.25 * direction.z;
      const color = ROOM_RADIANCE.map((channel) => channel * overhead);
      for (const box of boxes) {
        const angle = THREE.MathUtils.radToDeg(
          Math.acos(Math.min(direction.dot(box.axis), 1)),
        );
        const amount = 1 - smoothstep(box.inner, box.outer, angle);
        color[0] += box.radiance[0] * amount;
        color[1] += box.radiance[1] * amount;
        color[2] += box.radiance[2] * amount;
      }
      pixels.set([color[0], color[1], color[2], 1], (row * width + column) * 4);
    }
  }
  const equirect = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(equirect).texture;
  equirect.dispose();
  generator.dispose();
  return environment;
}

/** On the outer walls facing right and down, which only show once the icon tilts */
const WALL_GLOW_OUTSIDE = 0.55;
/** On the inner side of the right wall, the band the render shows through the face */
const WALL_GLOW_INSIDE = 0.95;
/** How much of the light the walls let through: the render's walls are smoky, the left most */
const WALL_SHADE = { left: [0.34, 0.24, 0.42], others: [0.7, 0.66, 0.78] };

/**
 * In the render, light from the glow block gets caught inside the clear block and travels
 * along its walls, and the walls themselves are smoky. Real-time glass does neither, so both
 * are painted on, per corner of the mesh:
 *
 * - the glass's own tint darkens on the walls, most on the left one
 * - a skin that only adds light puts the glow on the outer walls facing right and down
 * - the same on the inner side of the right wall, which leans in under the face. It is drawn
 *   with the solid things, before the glass, so the glass bends it like all else behind it.
 *
 * The glow follows the palette from bottom to top, so tint() repaints it when that changes.
 */
function paintWalls(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox as THREE.Box3;
  const count = positions.count;
  const shade = new Float32Array(count * 3);
  const rises = new Float32Array(count);
  const outsideAmounts = new Float32Array(count);
  const insideAmounts = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const normalX = normals.getX(index);
    const wall = (1 - Math.abs(normals.getZ(index))) ** 2;
    const leftward = smoothstep(0.1, -0.6, normalX);
    for (let channel = 0; channel < 3; channel += 1) {
      const tint = THREE.MathUtils.lerp(
        WALL_SHADE.others[channel],
        WALL_SHADE.left[channel],
        leftward,
      );
      shade[index * 3 + channel] = THREE.MathUtils.lerp(1, tint, wall);
    }
    rises[index] =
      (positions.getY(index) - bounds.min.y) / (bounds.max.y - bounds.min.y);
    const outward = smoothstep(
      -0.2,
      0.7,
      Math.max(normalX, -normals.getY(index)),
    );
    outsideAmounts[index] = wall * outward * WALL_GLOW_OUTSIDE;
    insideAmounts[index] =
      wall * smoothstep(0.3, 0.8, normalX) * WALL_GLOW_INSIDE;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(shade, 3));

  function skin(material: THREE.MeshBasicMaterialParameters) {
    const painted = geometry.clone();
    painted.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    return new THREE.Mesh(
      painted,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        ...material,
      }),
    );
  }

  const outside = skin({ transparent: true });
  const inside = skin({ side: THREE.BackSide });
  inside.renderOrder = 1;

  function tint(palette: GlowPalette) {
    const core = new THREE.Color(palette.core);
    const middle = new THREE.Color(palette.mid);
    const edge = new THREE.Color(palette.edge);
    const color = new THREE.Color();
    for (const [mesh, amounts] of [
      [outside, outsideAmounts],
      [inside, insideAmounts],
    ] as const) {
      const colors = mesh.geometry.getAttribute("color");
      for (let index = 0; index < count; index += 1) {
        const rise = rises[index];
        if (rise < 0.5) {
          color.lerpColors(core, middle, rise * 2);
        } else {
          color.lerpColors(middle, edge, rise * 2 - 1);
        }
        const amount = amounts[index];
        colors.setXYZ(
          index,
          color.r * amount,
          color.g * amount,
          color.b * amount,
        );
      }
      colors.needsUpdate = true;
    }
  }

  return { skins: [outside, inside], tint };
}

/** How the clear block is finished: polished like glass, or sanded so it blurs what is behind it */
export type GlowFinish = "glossy" | "frosted";

type ClearFinish = {
  roughness: number;
  dispersion: number;
  /** A smooth skin over the surface, so a frosted block still catches crisp highlights */
  clearcoat: number;
};

const CLEAR_FINISH: Record<GlowFinish, ClearFinish> = {
  // Nearly mirror smooth, with a little rainbow at the edges
  glossy: { roughness: 0.025, dispersion: 4, clearcoat: 0 },
  // The render's frost: it softens what is behind the block but keeps its outline readable
  frosted: { roughness: 0.42, dispersion: 0, clearcoat: 1 },
};

export type GlowIconScene = {
  /** Swaps the clear block's finish, at once */
  setFinish: (finish: GlowFinish) => void;
  /** Swaps the glow's colours, at once: they are only numbers the shaders read */
  setPalette: (palette: GlowPalette) => void;
  /** Where the cursor is, from -1 to 1 across the window, y up. Null lets the icon rest. */
  pointTo: (position: { x: number; y: number } | null) => void;
  dispose: () => void;
};

export async function createGlowIconScene(
  canvas: HTMLCanvasElement,
  firstPalette: GlowPalette,
): Promise<GlowIconScene> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The shaders finish their light with the render's own curve
  renderer.toneMapping = THREE.NoToneMapping;

  const model = await new GLTFLoader().loadAsync(`${ASSETS}/warp-icon.glb`);

  const scene = new THREE.Scene();
  const studio = studioEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(LENS_FOV, 1, 1, 2000);

  const glowPlanes = edgePlanes(GLOW_OUTLINE);
  const glowField = createGlowField(glowPlanes);

  /** One set of values every surface reads, so a change lands everywhere in the same frame */
  const shared = {
    uGlowPlanes: { value: glowPlanes },
    uGlowField: { value: glowField.texture },
    uFieldLow: { value: FIELD_LOW },
    uFieldSize: { value: FIELD_SIZE },
    uClearPlanes: { value: edgePlanes(CLEAR_OUTLINE) },
    uCore: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uEdge: { value: new THREE.Color() },
    uSun: { value: SUN.clone() },
    uEye: { value: new THREE.Vector3(0, 0, 100) },
    uPageSun: { value: SUN.clone() },
  };

  /**
   * A surface whose own light comes from a shader function, under three.js's usual sheen,
   * which is what puts the softbox highlights on its edges.
   */
  function litMaterial(
    pars: string,
    light: string,
    roughness: number,
    sheen: number,
  ) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness,
      metalness: 0,
      envMap: studio,
      envMapIntensity: sheen,
      dithering: true,
    });
    // three.js reuses a compiled shader between materials that look alike to it, and these
    // only differ in the code added below, so each says which one it is
    material.customProgramCacheKey = () => light;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${VERTEX_MAIN}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${pars}`)
        .replace(
          "#include <emissivemap_fragment>",
          `totalEmissiveRadiance = ${light};`,
        );
    };
    return material;
  }

  const page = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: PAGE_VERTEX,
      fragmentShader: PAGE_FRAGMENT,
      dithering: true,
      // Drawn first and never in the way, so a tilted plate can't dip through it
      depthTest: false,
      depthWrite: false,
    }),
  );
  page.renderOrder = -1;
  page.position.z = PAGE_Z;
  scene.add(page);

  const icon = new THREE.Group();
  scene.add(icon);

  function block(name: string) {
    const mesh =
      model.scene.getObjectByName(name.replace(" ", "_")) ??
      model.scene.getObjectByName(name);
    if (!(mesh instanceof THREE.Mesh)) {
      throw new Error(`warp-icon.glb has no mesh called ${name}`);
    }
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    const placed = new THREE.Mesh(mesh.geometry as THREE.BufferGeometry);
    icon.add(placed);
    return placed;
  }

  // The plate stays deep and dark: smooth enough that its face mirrors only the dim room
  // overhead, with a fine line of the key on its upper edge
  block("Base").material = litMaterial(PLATE_PARS, "plate()", 0.2, 0.25);
  block("Glow Block").material = litMaterial(GLOW_PARS, "glowBlock()", 0.12, 1);

  const clear = block("Clear Block");
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: CLEAR_FINISH.glossy.roughness,
    metalness: 0,
    transmission: 1,
    ior: 1.49,
    thickness: 1.6,
    dispersion: CLEAR_FINISH.glossy.dispersion,
    clearcoat: CLEAR_FINISH.glossy.clearcoat,
    clearcoatRoughness: 0.08,
    attenuationColor: new THREE.Color(0.7, 0.68, 0.85),
    attenuationDistance: 4,
    envMap: studio,
    vertexColors: true,
  });
  glass.onBeforeCompile = (shader) => {
    const frosted = THREE.ShaderChunk.transmission_pars_fragment.replace(
      FROST_SAMPLE_BEFORE,
      FROST_SAMPLE_AFTER,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <transmission_pars_fragment>",
      frosted,
    );
  };
  clear.material = glass;

  const walls = paintWalls(clear.geometry);
  icon.add(...walls.skins);

  const target = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  const turnedBack = new THREE.Quaternion();
  let frame = 0;
  let lastTime = 0;
  let disposed = false;

  function setPalette(palette: GlowPalette) {
    shared.uCore.value.set(palette.core);
    shared.uMid.value.set(palette.mid);
    shared.uEdge.value.set(palette.edge);
    glowField.paint(palette);
    walls.tint(palette);
    requestFrame();
  }

  function fit() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const visibleHeight = ICON_SIZE / ICON_SHARE / Math.min(camera.aspect, 1);
    camera.position.set(
      0,
      0,
      visibleHeight / 2 / Math.tan(THREE.MathUtils.degToRad(LENS_FOV / 2)),
    );
    camera.updateProjectionMatrix();
    requestFrame();
  }

  function draw(time: number) {
    frame = 0;
    if (disposed) {
      return;
    }
    const elapsed =
      lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    // Eases straight to the cursor with no overshoot, the same at any frame rate
    const step = 1 - Math.exp(-elapsed / TILT_SETTLE);
    tilt.x += (target.x - tilt.x) * step;
    tilt.y += (target.y - tilt.y) * step;
    const reach = THREE.MathUtils.degToRad(MAX_TILT);
    // The face turns towards the cursor
    icon.rotation.set(-tilt.y * reach, tilt.x * reach, 0);
    // The sun and the eye stay put in the room, so in the icon's own space they turn the
    // other way: shadows slide and the glow shifts inside its block as the icon tilts
    turnedBack.copy(icon.quaternion).invert();
    shared.uSun.value.copy(SUN).applyQuaternion(turnedBack);
    shared.uEye.value.copy(camera.position).applyQuaternion(turnedBack);
    renderer.render(scene, camera);
    canvas.dataset.samples = "1";

    const resting =
      Math.abs(target.x - tilt.x) < REST_EPSILON &&
      Math.abs(target.y - tilt.y) < REST_EPSILON;
    if (resting) {
      // Nothing moves until the cursor does, so a still icon costs no GPU
      lastTime = 0;
      return;
    }
    requestFrame();
  }

  function requestFrame() {
    if (frame === 0 && !disposed) {
      frame = requestAnimationFrame(draw);
    }
  }

  setPalette(firstPalette);
  const observer = new ResizeObserver(fit);
  observer.observe(canvas);
  fit();

  return {
    setPalette,
    setFinish(finish) {
      glass.roughness = CLEAR_FINISH[finish].roughness;
      glass.dispersion = CLEAR_FINISH[finish].dispersion;
      glass.clearcoat = CLEAR_FINISH[finish].clearcoat;
      requestFrame();
    },
    pointTo(position) {
      target.x = position ? THREE.MathUtils.clamp(position.x, -1, 1) : 0;
      target.y = position ? THREE.MathUtils.clamp(position.y, -1, 1) : 0;
      requestFrame();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      studio.dispose();
      glowField.texture.dispose();
      renderer.dispose();
    },
  };
}
