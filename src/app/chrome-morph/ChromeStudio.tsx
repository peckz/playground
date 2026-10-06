"use client";

import { button, folder, Leva, useControls } from "leva";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useEscapeToHome } from "@/lib/useEscapeToHome";
import { cn } from "@/lib/utils";
import { usePixelSnap } from "@/lib/usePixelSnap";
import styles from "./chrome.module.css";
import {
  BLADE_PATHS,
  buildTracks,
  CENTER,
  CORE_RADIUS,
  DOT_PATHS,
  type Frame,
  frameAt,
  mixColor,
  sampleShape,
  type Track,
} from "./chromeMotion";

const AUTOPLAY_FIRST_MS = 450;
const AUTOPLAY_HOLD_MS = { logo: 1600, dots: 900 };

/** Background, dot colour, and whether the logo keeps its own colours */
const THEMES = {
  Lilac: { bg: "#e9e2ff", ink: "#22183f" },
  Butter: { bg: "#fff1b8", ink: "#1f1a10" },
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

type Settings = {
  spin: number;
  twist: number;
  expandAt: number;
  duration: number;
  shutter: number;
  soften: number;
  speed: number;
  freeze: boolean;
  colors: ColorMode;
  theme: ThemeName;
};

type Playback = {
  /** Toward the logo, or back to the dots */
  toLogo: boolean;
  /** 0-1 through the play, advanced by frame delta times the speed */
  progress: number;
  playing: boolean;
  /** Clicked during the play: run the next one as soon as this lands */
  queued: boolean;
};

export default function ChromeStudio() {
  useEscapeToHome();
  const [isLogo, setIsLogo] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<(SVGGElement | null)[]>([]);
  const pieceRefs = useRef<(SVGPathElement | null)[][]>(LAYERS.map(() => []));
  const coreRefs = useRef<(SVGCircleElement | null)[]>([]);
  const softenGroupRef = useRef<SVGGElement>(null);
  const softenBlurRef = useRef<SVGFEGaussianBlurElement>(null);

  const isLogoRef = useRef(false);
  const tracksRef = useRef<Track[] | null>(null);
  const playbackRef = useRef<Playback>({
    toLogo: true,
    progress: 1,
    playing: false,
    queued: false,
  });

  const controls = useControls({
    autoplay: false,
    speed: { value: 1, options: { "1x": 1, "0.5x": 0.5, "0.25x": 0.25 } },
    theme: {
      value: "Lilac" as ThemeName,
      options: Object.keys(THEMES) as ThemeName[],
    },
    colors: { value: "Solid" as ColorMode, options: [...COLOR_MODES] },
    size: { value: 16, options: { "12x": 12, "16x": 16, "20x": 20 } },
    // leva runs this on click, not during render
    // eslint-disable-next-line react-hooks/refs
    "dots / logo": button(() => toggle()),
    motion: folder({
      spin: { value: 180, min: 180, max: 540, step: 5 },
      expandAt: {
        value: 0.3,
        min: 0,
        max: 0.6,
        step: 0.01,
        label: "expand at",
      },
      twist: { value: 45, min: 0, max: 180, step: 5 },
      duration: { value: 600, min: 250, max: 1500, step: 10 },
    }),
    "motion blur": folder({
      shutter: { value: 360, min: 0, max: 720, step: 15 },
      soften: { value: 0.5, min: 0, max: 2, step: 0.05 },
    }),
    "under the hood": folder({
      freeze: false,
      scrub: { value: 30, min: 0, max: 100, step: 0.5 },
    }),
  });

  // The frame loop reads settings from a ref so panel tweaks never restart it
  const settingsRef = useRef<Settings>(controls);
  useEffect(() => {
    settingsRef.current = controls;
  }, [controls]);

  usePixelSnap(stageRef, controls.size);

  // Resample once on the client, re-pair dots and blades whenever the spin changes
  const shapesRef = useRef<ReturnType<typeof sampleAll> | null>(null);
  useEffect(() => {
    if (!shapesRef.current) {
      shapesRef.current = sampleAll();
    }
    tracksRef.current = buildTracks(
      shapesRef.current.dots,
      shapesRef.current.blades,
      controls.spin,
    );
  }, [controls.spin]);

  function toggle() {
    const playback = playbackRef.current;
    // Both directions spin clockwise, so a click mid-play can't reverse it.
    // It queues the next play instead, which chains on round the circle
    if (playback.playing) {
      playback.queued = !playback.queued;
      return;
    }
    startPlay();
  }

  function startPlay() {
    const next = !isLogoRef.current;
    isLogoRef.current = next;
    setIsLogo(next);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    playbackRef.current = {
      toLogo: next,
      progress: reduceMotion ? 1 : 0,
      playing: !reduceMotion,
      queued: false,
    };
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

  function renderSoften(stdDeviation: number) {
    if (stdDeviation < 0.01) {
      softenGroupRef.current?.removeAttribute("filter");
      return;
    }
    softenBlurRef.current?.setAttribute(
      "stdDeviation",
      stdDeviation.toFixed(3),
    );
    softenGroupRef.current?.setAttribute("filter", "url(#chrome-soften)");
  }

  /** At rest the source paths are drawn as-is, so the still frame is the real icon */
  function renderRest(logo: boolean) {
    const layer = layerRefs.current[0];
    layer?.removeAttribute("display");
    layer?.setAttribute("opacity", "1");
    const paths = logo ? BLADE_PATHS : DOT_PATHS;
    paths.forEach((d, index) => {
      const element = pieceRefs.current[0][index];
      element?.setAttribute("d", d);
      element?.setAttribute("fill", colorFor(index, logo ? 1 : 0));
    });
    renderCore(0, logo ? CORE_RADIUS : 0);
    hideLayersAfter(1);
    renderSoften(0);
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

  function drawAt(progress: number, toLogo: boolean) {
    const tracks = tracksRef.current;
    if (!tracks) {
      return;
    }
    const settings = settingsRef.current;
    const shutterProgress =
      ((settings.shutter / 360) * FRAME_MS) / settings.duration;

    if (shutterProgress <= 0) {
      renderLayer(0, frameAt(progress, toLogo, tracks, settings), 1);
      hideLayersAfter(1);
    } else {
      // Centred shutter: half the samples trail the frame, half lead it
      LAYERS.forEach((layerIndex) => {
        const offset =
          (layerIndex / (BLUR_SAMPLES - 1) - 0.5) * shutterProgress;
        const sampleProgress = Math.min(1, Math.max(0, progress + offset));
        renderLayer(
          layerIndex,
          frameAt(sampleProgress, toLogo, tracks, settings),
          SAMPLE_OPACITY,
        );
      });
    }

    const velocity = frameAt(progress, toLogo, tracks, settings).velocity;
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
        playback.progress += (delta * settings.speed) / settings.duration;
        if (playback.progress >= 1) {
          playback.playing = false;
          renderRest(playback.toLogo);
          if (playback.queued) {
            startPlay();
          }
        } else {
          drawAt(playback.progress, playback.toLogo);
        }
      } else {
        renderRest(isLogoRef.current);
      }
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
    // drawAt and renderRest only read refs
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

  // Autoplay: morph, hold, back, hold, forever
  useEffect(() => {
    if (!controls.autoplay || controls.freeze) {
      return;
    }
    let timeout = 0;
    function schedule(delay: number) {
      timeout = window.setTimeout(() => {
        toggle();
        const hold = AUTOPLAY_HOLD_MS[isLogoRef.current ? "logo" : "dots"];
        const settings = settingsRef.current;
        schedule(hold + settings.duration / settings.speed);
      }, delay);
    }
    schedule(AUTOPLAY_FIRST_MS);
    return () => window.clearTimeout(timeout);
    // toggle only touches refs and stable setters
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
            className={cn(
              styles.button,
              "rounded-[48px] outline-none focus-visible:ring-2 focus-visible:ring-current/40",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              width={pixelSize}
              height={pixelSize}
              className={styles.icon}
              aria-hidden="true"
            >
              <defs>
                <filter
                  id="chrome-soften"
                  filterUnits="userSpaceOnUse"
                  x={-6}
                  y={-6}
                  width={36}
                  height={36}
                >
                  <feGaussianBlur ref={softenBlurRef} stdDeviation={0} />
                </filter>
              </defs>
              <g ref={softenGroupRef}>
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
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
}

function sampleAll() {
  return {
    dots: DOT_PATHS.map((d) => sampleShape(d)),
    blades: BLADE_PATHS.map((d) => sampleShape(d)),
  };
}
