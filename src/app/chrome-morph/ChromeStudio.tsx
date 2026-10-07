"use client";

import { button, folder, Leva, useControls } from "leva";
import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useEscapeToHome } from "@/lib/useEscapeToHome";
import { cn } from "@/lib/utils";
import { usePixelSnap } from "@/lib/usePixelSnap";
import styles from "./chrome.module.css";
import {
  BLADE_PATHS,
  buildTracks,
  CENTER,
  CORE_RADIUS,
  type Direction,
  DOT_PATHS,
  type Frame,
  appearFrameAt,
  frameAt,
  mixColor,
  sampleShape,
  SINGLE_DOT_PATH,
  splitFrameAt,
  splitGooAt,
  type Track,
} from "./chromeMotion";

/**
 * The icon rests in one of three stages and only ever steps to a neighbour:
 * hover splits the dot into three, a click morphs them into the logo and
 * back, and leaving walks it all the way home to the single dot
 */
const STAGES = ["dot", "dots", "logo"] as const;
type Stage = (typeof STAGES)[number];

/** On load the single dot swells in */
const APPEAR_MS = 320;
const MERGE_MS = 380;

/** Autoplay walks the whole loop, holding on each stage it lands on */
const AUTOPLAY_LOOP: Stage[] = ["dots", "logo", "dots", "dot"];
const AUTOPLAY_HOLD_MS: Record<Stage, number> = {
  dot: 700,
  dots: 600,
  logo: 1600,
};

/** Background, dot colour, and whether the logo keeps its own colours */
const THEMES = {
  Lilac: { bg: "#e9e2ff", ink: "#22183f" },
  Butter: { bg: "#ffd43b", ink: "#1f1a10" },
  Sky: { bg: "#d6e8ff", ink: "#0f1d33" },
  Paper: { bg: "#f6f3ec", ink: "#202124" },
  Night: { bg: "#0d0d10", ink: "#f2f2f2" },
} as const;

type ThemeName = keyof typeof THEMES;

/** Blade colours in BLADE_PATHS order, then the core */
const CHROME_COLORS = ["#ea4335", "#34a853", "#fbbc04"];
const CORE_COLOR = "#4285f4";

/** Chrome: the dots bloom into the logo's colours. Solid: everything stays the theme ink */
const COLOR_MODES = ["Chrome", "Solid"] as const;
type ColorMode = (typeof COLOR_MODES)[number];

/** Which way the dots orbit, both into the logo and back */
const DIRECTIONS = {
  clockwise: 1,
  "counter-clockwise": -1,
} satisfies Record<string, Direction>;

/**
 * Motion blur the After Effects way: every frame stacks sub-frames spread
 * across the shutter. Each is translucent, so wherever all of them overlap the
 * shape reads solid and the fast edges smear into a falloff.
 */
const BLUR_SAMPLES = 10;
const LAYERS = Array.from({ length: BLUR_SAMPLES }, (_, index) => index);
/** Per-sample opacity that stacks up to 99% where every sample overlaps */
const SAMPLE_OPACITY = 1 - Math.pow(0.01, 1 / BLUR_SAMPLES);
/** Shutter angle is measured against a 60fps frame, like a comp in AE */
const FRAME_MS = 1000 / 60;
/** Soft blur in viewBox units per unit of orbit velocity, at soften 1 */
const SOFTEN_UNITS = 0.12;

/**
 * Liquid split: blur the dots, then snap the alpha back to a hard edge. Where
 * two blurred dots overlap their alpha adds up past the cut, so a neck of goo
 * joins them and pinches off as they drip apart. Translucent motion blur
 * samples stack into one solid stretched droplet the same way
 */
const GOO_UNITS = 1.1;
/** Alpha x 18 - 7: anything under ~40% alpha drops out, the rest goes solid */
const GOO_MATRIX = "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7";

type Settings = {
  spin: number;
  twist: number;
  expandAt: number;
  duration: number;
  shutter: number;
  soften: number;
  goo: number;
  split: number;
  size: number;
  speed: number;
  freeze: boolean;
  colors: ColorMode;
  theme: ThemeName;
};

type Playback = {
  /** appear: the dot swells in. split: one dot and three. morph: three dots and the logo */
  kind: "appear" | "split" | "morph";
  /** Away from the single dot: splitting into three, or morphing into the logo */
  forward: boolean;
  /** 0-1 through the play, advanced by frame delta times the speed */
  progress: number;
  playing: boolean;
};

type ChromeStudioProps = {
  /** ?record: a clean stage for screen capture, panel hidden and autoplay on */
  record: boolean;
};

export default function ChromeStudio(props: ChromeStudioProps) {
  useEscapeToHome();
  const [isLogo, setIsLogo] = useState(false);
  const [panelHidden, setPanelHidden] = useState(props.record);

  const stageRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(SVGGElement | null)[]>([]);
  const pieceRefs = useRef<(SVGPathElement | null)[][]>(LAYERS.map(() => []));
  const coreRefs = useRef<(SVGCircleElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const softenGroupRef = useRef<SVGGElement>(null);
  const gooGroupRef = useRef<SVGGElement>(null);
  const gooBlurRef = useRef<SVGFEGaussianBlurElement>(null);

  /** The stage the icon rests on, or is playing toward */
  const currentRef = useRef<Stage>("dot");
  /** Where hover, clicks and autoplay want the icon. Plays step toward it whenever the icon comes to rest */
  const targetRef = useRef<Stage>("dot");
  const tracksRef = useRef<Track[] | null>(null);
  const playbackRef = useRef<Playback>({
    kind: "appear",
    forward: true,
    progress: 1,
    playing: false,
  });

  const controls = useControls({
    autoplay: props.record,
    speed: { value: 1, options: { "1x": 1, "0.5x": 0.5, "0.25x": 0.25 } },
    theme: {
      value: "Butter" as ThemeName,
      options: Object.keys(THEMES) as ThemeName[],
    },
    colors: { value: "Solid" as ColorMode, options: [...COLOR_MODES] },
    size: {
      value: props.record ? 20 : 16,
      options: { "12x": 12, "16x": 16, "20x": 20 },
    },
    direction: { value: 1 as Direction, options: DIRECTIONS },
    // leva runs these on click, not during render
    // eslint-disable-next-line react-hooks/refs
    "dot / dots": button(() =>
      setTarget(targetRef.current === "dot" ? "dots" : "dot"),
    ),
    "dots / logo": button(() => toggle()),
    "replay intro": button(() => startAppear()),
    motion: folder(
      {
        spin: { value: 270, min: 180, max: 720, step: 5 },
        expandAt: {
          value: 0.3,
          min: 0,
          max: 0.7,
          step: 0.01,
          label: "expand at",
        },
        twist: { value: 45, min: 0, max: 180, step: 5 },
        duration: { value: 600, min: 250, max: 1500, step: 10 },
      },
      { collapsed: true },
    ),
    "motion blur": folder(
      {
        shutter: { value: 360, min: 0, max: 720, step: 15 },
        soften: { value: 0.5, min: 0, max: 2, step: 0.05 },
      },
      { collapsed: true },
    ),
    split: folder(
      {
        goo: { value: 1, min: 0, max: 2, step: 0.05 },
        split: {
          value: 420,
          min: 200,
          max: 1000,
          step: 10,
          label: "duration",
        },
      },
      { collapsed: true },
    ),
    "under the hood": folder({
      freeze: false,
      scrub: { value: 0, min: 0, max: 100, step: 0.5 },
    }),
  });

  // The frame loop reads settings from a ref so panel tweaks never restart it
  const settingsRef = useRef<Settings>(controls);
  useEffect(() => {
    settingsRef.current = controls;
  }, [controls]);

  usePixelSnap(stageRef, controls.size);

  // Resample once on the client, re-pair dots and blades whenever the spin or direction changes
  const shapesRef = useRef<ReturnType<typeof sampleAll> | null>(null);
  useEffect(() => {
    if (!shapesRef.current) {
      shapesRef.current = sampleAll();
    }
    tracksRef.current = buildTracks(
      shapesRef.current.dots,
      shapesRef.current.blades,
      controls.spin,
      controls.direction,
    );
  }, [controls.spin, controls.direction]);

  /** Click: three dots to the logo and back. From the single dot it walks the whole way */
  function toggle() {
    setTarget(targetRef.current === "logo" ? "dots" : "logo");
  }

  function setTarget(stage: Stage) {
    targetRef.current = stage;
    settle();
  }

  /**
   * Steps one stage toward the target. Nothing reverses midway, since the
   * spin only ever goes one way, so a change of mind waits for the play to
   * land. The frame loop calls this again whenever a play lands
   */
  function settle() {
    if (playbackRef.current.playing) {
      return;
    }
    const from = STAGES.indexOf(currentRef.current);
    const to = STAGES.indexOf(targetRef.current);
    if (from === to) {
      return;
    }
    startStep(STAGES[from + Math.sign(to - from)]);
  }

  /** Hover in splits the dot, hover out walks it home. Mouse only, so a tap stays a click */
  function handlePointerHover(event: ReactPointerEvent, entering: boolean) {
    if (event.pointerType !== "mouse" || props.record) {
      return;
    }
    if (!entering) {
      setTarget("dot");
    } else if (targetRef.current === "dot") {
      setTarget("dots");
    }
  }

  function startStep(next: Stage) {
    const from = currentRef.current;
    currentRef.current = next;
    setIsLogo(next === "logo");
    const touchesLogo = from === "logo" || next === "logo";
    if (prefersReducedMotion()) {
      playbackRef.current.playing = false;
      renderRest(next);
      settle();
      return;
    }
    playbackRef.current = {
      kind: touchesLogo ? "morph" : "split",
      forward: touchesLogo ? next === "logo" : next === "dots",
      progress: 0,
      playing: true,
    };
  }

  function startAppear() {
    currentRef.current = "dot";
    targetRef.current = "dot";
    setIsLogo(false);
    if (prefersReducedMotion()) {
      renderRest("dot");
      return;
    }
    playbackRef.current = {
      kind: "appear",
      forward: true,
      progress: 0,
      playing: true,
    };
    drawPlay(playbackRef.current);
  }

  function playMsFor(kind: Playback["kind"], forward: boolean) {
    const settings = settingsRef.current;
    if (kind === "appear") {
      return APPEAR_MS;
    }
    if (kind === "split") {
      return forward ? settings.split : MERGE_MS;
    }
    return settings.duration;
  }

  function colorFor(colorIndex: number, mix: number) {
    const settings = settingsRef.current;
    const ink = THEMES[settings.theme].ink;
    if (settings.colors === "Solid") {
      return ink;
    }
    return mixColor(ink, CHROME_COLORS[colorIndex], mix);
  }

  function renderLayer(layerIndex: number, frame: Frame, opacity: number) {
    const layer = layerRefs.current[layerIndex];
    layer?.removeAttribute("display");
    layer?.setAttribute("opacity", opacity.toFixed(3));
    frame.pieces.forEach((piece, index) => {
      const element = pieceRefs.current[layerIndex][index];
      element?.setAttribute("d", piece.d);
      element?.setAttribute("fill", colorFor(piece.colorIndex, piece.mix));
    });
    renderCore(layerIndex, frame.coreRadius);
  }

  /** Only the first layer is used at rest */
  function hideLayersAfter(count: number) {
    LAYERS.slice(count).forEach((layerIndex) => {
      layerRefs.current[layerIndex]?.setAttribute("display", "none");
    });
  }

  /**
   * A CSS blur on the svg runs on the GPU. The same blur as an svg <filter> is
   * redrawn on the CPU every frame in Safari, which dropped iOS to ~10fps
   */
  function renderSoften(stdDeviation: number) {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    if (stdDeviation < 0.01) {
      svg.style.filter = "";
      return;
    }
    // stdDeviation is in viewBox units, and the svg draws `size` px per unit
    const pixels = stdDeviation * settingsRef.current.size;
    svg.style.filter = `blur(${pixels.toFixed(2)}px)`;
  }

  /** At rest the source paths are drawn as-is, so the still frame is the real icon */
  function renderRest(stage: Stage) {
    const layer = layerRefs.current[0];
    layer?.removeAttribute("display");
    layer?.setAttribute("opacity", "1");
    const logo = stage === "logo";
    const paths = REST_PATHS[stage];
    paths.forEach((d, index) => {
      const element = pieceRefs.current[0][index];
      element?.setAttribute("d", d);
      element?.setAttribute("fill", colorFor(index, logo ? 1 : 0));
    });
    renderCore(0, logo ? CORE_RADIUS : 0);
    hideLayersAfter(1);
    renderSoften(0);
    renderGoo(0);
  }

  function renderCore(layerIndex: number, radius: number) {
    const settings = settingsRef.current;
    const core = coreRefs.current[layerIndex];
    core?.setAttribute("r", radius.toFixed(3));
    core?.setAttribute(
      "fill",
      settings.colors === "Solid" ? THEMES[settings.theme].ink : CORE_COLOR,
    );
  }

  function renderGoo(stdDeviation: number) {
    if (stdDeviation < 0.01) {
      gooGroupRef.current?.removeAttribute("filter");
      return;
    }
    gooBlurRef.current?.setAttribute("stdDeviation", stdDeviation.toFixed(3));
    gooGroupRef.current?.setAttribute("filter", "url(#chrome-goo)");
  }

  function drawAt(progress: number, toLogo: boolean) {
    const tracks = tracksRef.current;
    if (!tracks) {
      return;
    }
    renderGoo(0);
    const settings = settingsRef.current;
    drawBlurred(progress, settings.duration, (sampleProgress) =>
      frameAt(sampleProgress, toLogo, tracks, settings),
    );
  }

  function drawPlay(playback: Playback) {
    const settings = settingsRef.current;
    const playMs = playMsFor(playback.kind, playback.forward);
    if (playback.kind === "morph") {
      drawAt(playback.progress, playback.forward);
      return;
    }
    if (playback.kind === "appear") {
      renderGoo(0);
      drawBlurred(playback.progress, playMs, appearFrameAt);
      return;
    }
    drawBlurred(playback.progress, playMs, (sampleProgress) =>
      splitFrameAt(sampleProgress, playback.forward),
    );
    renderGoo(
      settings.goo *
        splitGooAt(playback.progress, playback.forward) *
        GOO_UNITS,
    );
  }

  /** Stacks shutter samples of any play, `playMs` long, around `progress` */
  function drawBlurred(
    progress: number,
    playMs: number,
    frameFor: (sampleProgress: number) => Frame,
  ) {
    const settings = settingsRef.current;
    const shutterProgress = ((settings.shutter / 360) * FRAME_MS) / playMs;

    if (shutterProgress <= 0) {
      renderLayer(0, frameFor(progress), 1);
      hideLayersAfter(1);
    } else {
      // Centred shutter: half the samples trail the frame, half lead it
      LAYERS.forEach((layerIndex) => {
        const offset =
          (layerIndex / (BLUR_SAMPLES - 1) - 0.5) * shutterProgress;
        const sampleProgress = Math.min(1, Math.max(0, progress + offset));
        renderLayer(layerIndex, frameFor(sampleProgress), SAMPLE_OPACITY);
      });
    }

    const velocity = frameFor(progress).velocity;
    renderSoften(settings.soften * velocity * SOFTEN_UNITS);
  }

  // Frame loop: advance the play, then write attributes straight to the svg
  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();

    function tick(now: number) {
      const delta = Math.min(64, now - lastTime);
      lastTime = now;
      const playback = playbackRef.current;
      const settings = settingsRef.current;

      if (settings.freeze) {
        // The scrub effect owns the frame
      } else if (playback.playing) {
        const playMs = playMsFor(playback.kind, playback.forward);
        playback.progress += (delta * settings.speed) / playMs;
        if (playback.progress >= 1) {
          playback.playing = false;
          renderRest(currentRef.current);
          settle();
        } else {
          drawPlay(playback);
        }
      } else {
        renderRest(currentRef.current);
      }
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
    // drawAt and renderRest only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swell in on load. A layout effect, so the server-rendered dots never flash first
  useLayoutEffect(() => {
    softenGroupRef.current?.removeAttribute("visibility");
    startAppear();
    // startAppear only touches refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frozen: the scrub slider picks the frame, for stills and slow reveals
  useEffect(() => {
    if (controls.freeze) {
      drawAt(controls.scrub / 100, true);
    }
    // drawAt reads the latest settings from the ref, which the render above just set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  // Autoplay: walk the loop, holding on each stage once the icon lands there
  useEffect(() => {
    if (!controls.autoplay || controls.freeze) {
      return;
    }
    let loopIndex = 0;
    let landedAt: number | null = null;
    const interval = window.setInterval(() => {
      const landed =
        !playbackRef.current.playing &&
        currentRef.current === targetRef.current;
      if (!landed) {
        landedAt = null;
        return;
      }
      const now = performance.now();
      landedAt ??= now;
      const hold =
        AUTOPLAY_HOLD_MS[currentRef.current] / settingsRef.current.speed;
      if (now - landedAt >= hold) {
        landedAt = null;
        setTarget(AUTOPLAY_LOOP[loopIndex % AUTOPLAY_LOOP.length]);
        loopIndex++;
      }
    }, 50);
    return () => window.clearInterval(interval);
    // setTarget only touches refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.autoplay, controls.freeze]);

  // H hides the panel for a clean recording
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "h" || event.key === "H") {
        setPanelHidden((current) => !current);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const theme = THEMES[controls.theme];
  const pixelSize = 24 * controls.size;

  return (
    <div
      className={cn(styles.canvas, "min-h-screen flex flex-col")}
      style={{ "--bg": theme.bg, "--ink": theme.ink } as CSSProperties}
    >
      <Leva hidden={panelHidden} titleBar={{ title: "chrome  ·  H to hide" }} />

      <header
        className={cn(
          "w-full max-w-xl mx-auto p-4 text-sm transition-opacity",
          panelHidden && "opacity-0",
        )}
      >
        <Link href="/" className={styles.back}>
          {"<———"}
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center pb-16 px-4">
        <div ref={stageRef} className="relative">
          <button
            type="button"
            aria-label={isLogo ? "Back to the menu dots" : "Morph into Chrome"}
            aria-pressed={isLogo}
            onClick={toggle}
            onPointerEnter={(event) => handlePointerHover(event, true)}
            onPointerLeave={(event) => handlePointerHover(event, false)}
            className={cn(
              styles.button,
              props.record && styles.recording,
              "rounded-[48px] outline-none focus-visible:ring-2 focus-visible:ring-current/40",
            )}
          >
            <svg
              ref={svgRef}
              viewBox="0 0 24 24"
              width={pixelSize}
              height={pixelSize}
              className={styles.icon}
              aria-hidden="true"
            >
              <defs>
                <filter
                  id="chrome-goo"
                  filterUnits="userSpaceOnUse"
                  x={-6}
                  y={-12}
                  width={36}
                  height={44}
                >
                  <feGaussianBlur ref={gooBlurRef} stdDeviation={0} />
                  <feColorMatrix type="matrix" values={GOO_MATRIX} />
                </filter>
              </defs>
              {/* Hidden until the swell-in takes over, see the layout effect */}
              <g ref={gooGroupRef}>
                <g ref={softenGroupRef} visibility="hidden">
                  {LAYERS.map((layerIndex) => (
                    <g
                      key={layerIndex}
                      ref={(element) => {
                        layerRefs.current[layerIndex] = element;
                      }}
                      display={layerIndex === 0 ? undefined : "none"}
                    >
                      {DOT_PATHS.map((d, index) => (
                        <path
                          key={index}
                          ref={(element) => {
                            pieceRefs.current[layerIndex][index] = element;
                          }}
                          d={d}
                          fill={theme.ink}
                        />
                      ))}
                      <circle
                        ref={(element) => {
                          coreRefs.current[layerIndex] = element;
                        }}
                        cx={CENTER}
                        cy={CENTER}
                        r={0}
                      />
                    </g>
                  ))}
                </g>
              </g>
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
}

const REST_PATHS: Record<Stage, string[]> = {
  dot: DOT_PATHS.map(() => SINGLE_DOT_PATH),
  dots: DOT_PATHS,
  logo: BLADE_PATHS,
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sampleAll() {
  return {
    dots: DOT_PATHS.map((d) => sampleShape(d)),
    blades: BLADE_PATHS.map((d) => sampleShape(d)),
  };
}
