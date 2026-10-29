"use client";

import { button, folder, Leva, useControls } from "leva";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useEscapeToHome } from "@/lib/useEscapeToHome";
import { cn } from "@/lib/utils";
import { usePixelSnap } from "@/lib/usePixelSnap";
import { CHECK } from "./successMotion";
import styles from "./wifi.module.css";
import {
  ARC_PATHS,
  DOT,
  EASINGS,
  type EasingName,
  type Frame,
  STAGGER_FROM,
  type StaggerFrom,
} from "./wifiMotion";
import {
  type ToggleSettings,
  toggleFrameAt,
  toggleLook,
  toggleMs,
} from "./toggleMotion";

const THEMES = {
  White: { bg: "#ffffff", ink: "#000000" },
  Paper: { bg: "#f4f4f4", ink: "#000000" },
  Night: { bg: "#0d0d10", ink: "#f2f2f2" },
} as const;

type ThemeName = keyof typeof THEMES;

/** Strokes snap between dimmed and connected on this time constant */
const LIGHT_TAU = 35;

const AUTOPLAY_FIRST_MS = 600;
/** How long it sits connected before autoplay switches it off */
const AUTOPLAY_HOLD_MS = 1400;
/** How long it sits disconnected before autoplay connects again */
const AUTOPLAY_REST_MS = 900;

type Settings = ToggleSettings & {
  freeze: boolean;
  scrub: number;
  speed: number;
  /** Share of ink in the strokes while disconnected, the rest is background */
  dim: number;
  /** Share of ink in the strokes once connected */
  connectedInk: number;
  /** Opacity of the green tile, in % */
  tint: number;
};

/**
 * The tile behind the icon: nothing while disconnected or searching, green
 * once the check draws, then a light gray, like hovered, once it settles.
 */
type Tile = "none" | "green" | "settled";

function percent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

type WifiToggleStudioProps = {
  /** ?record: a clean stage for screen capture, panel hidden and autoplay on */
  record: boolean;
};

export default function WifiToggleStudio(props: WifiToggleStudioProps) {
  useEscapeToHome();
  const [panelHidden, setPanelHidden] = useState(props.record);

  const stageRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const arcRefs = useRef<(SVGPathElement | null)[]>([]);
  const dotRef = useRef<SVGCircleElement>(null);
  const legRefs = useRef<(SVGPathElement | null)[]>([]);

  /** Time into the play in ms, Infinity when it isn't running */
  const elapsedRef = useRef(Infinity);
  const connectedRef = useRef(false);
  /** The strokes, from dimmed (0) to connected (1) */
  const litRef = useRef(0);

  const controls = useControls({
    autoplay: props.record,
    colours: folder({
      dim: { value: 22, min: 0, max: 60, step: 1, label: "off ink %" },
      connectedInk: { value: 70, min: 0, max: 100, step: 1, label: "on ink %" },
      tint: { value: 35, min: 0, max: 100, step: 1, label: "green %" },
    }),
    wave: folder({
      // The dot hops instead of swelling here, so this stays hidden
      dotGrow: { value: 1.4, min: 1, max: 2, step: 0.05, render: () => false },
      arcGrow: { value: 1.08, min: 1, max: 1.3, step: 0.01 },
      waveStagger: { value: 55, min: 0, max: 200, step: 5 },
      swellPeak: { value: 110, min: 60, max: 400, step: 10 },
      swellLength: { value: 700, min: 300, max: 1600, step: 20 },
    }),
    loading: folder({
      hops: { value: 3, min: 1, max: 10, step: 1 },
      hopHeight: { value: 2.5, min: 0, max: 5, step: 0.25 },
    }),
    check: folder({
      hold: { value: 500, min: 0, max: 1500, step: 20 },
      bounce: { value: 1, min: 0, max: 2, step: 0.05 },
      duration: { value: 900, min: 300, max: 2000, step: 10 },
      stagger: { value: 80, min: 0, max: 300, step: 5 },
      from: { value: "bottom" as StaggerFrom, options: [...STAGGER_FROM] },
      gap: { value: 0.5, min: 0.1, max: 1, step: 0.05 },
      easing: {
        value: "kick" as EasingName,
        options: Object.keys(EASINGS) as EasingName[],
      },
    }),
    speed: { value: 1, options: { "1x": 1, "0.5x": 0.5, "0.25x": 0.25 } },
    theme: {
      value: "White" as ThemeName,
      options: Object.keys(THEMES) as ThemeName[],
    },
    size: { value: 8, options: { "6x": 6, "8x": 8, "10x": 10 } },
    // leva runs this on click, not during render
    // eslint-disable-next-line react-hooks/refs
    toggle: button(() => toggle()),
    "under the hood": folder({
      freeze: false,
      scrub: { value: 40, min: 0, max: 100, step: 0.5 },
    }),
  });

  // The frame loop reads settings from a ref so panel tweaks never restart it
  const settingsRef = useRef<Settings>(controls);
  useEffect(() => {
    settingsRef.current = controls;
  }, [controls]);

  usePixelSnap(stageRef, controls.size);

  /**
   * Off: search, load and connect. On: switch back off. A play already running
   * finishes rather than jumping back to its start.
   */
  function toggle() {
    if (elapsedRef.current !== Infinity) {
      return;
    }
    if (connectedRef.current) {
      connectedRef.current = false;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      connectedRef.current = true;
      return;
    }
    elapsedRef.current = 0;
  }

  /** Eases the strokes toward their target and writes the tile's colours */
  function light(
    target: number,
    delta: number,
    tile: Tile,
    settings: Settings,
  ) {
    const lit =
      litRef.current +
      (target - litRef.current) * (1 - Math.exp(-delta / LIGHT_TAU));
    litRef.current = Math.abs(target - lit) < 0.001 ? target : lit;
    const element = buttonRef.current;
    if (!element) {
      return;
    }
    const ink =
      settings.dim + (settings.connectedInk - settings.dim) * litRef.current;
    element.style.setProperty(
      "--icon",
      `color-mix(in oklab, var(--ink) ${percent(ink)}, var(--bg))`,
    );
    const backgrounds: Record<Tile, string> = {
      none: "",
      green: `color(display-p3 0.2 0.9 0.35 / ${settings.tint / 100})`,
      // The button's own hover tint
      settled: "color-mix(in oklab, var(--ink) 6%, transparent)",
    };
    element.style.backgroundColor = backgrounds[tile];
  }

  function render(frame: Frame) {
    frame.arcs.forEach((arcFrame, index) => {
      const arc = arcRefs.current[index];
      if (!arc) {
        return;
      }
      arc.setAttribute("stroke-dasharray", arcFrame.dasharray);
      arc.setAttribute("stroke-dashoffset", arcFrame.dashoffset);
      arc.setAttribute("transform", arcFrame.transform);
    });
    const dot = dotRef.current;
    if (dot) {
      dot.setAttribute("transform", frame.dot.transform);
      dot.setAttribute("opacity", frame.dot.visible ? "1" : "0");
    }
    legRefs.current.forEach((leg, index) => {
      if (!leg) {
        return;
      }
      leg.setAttribute("stroke-dasharray", frame.check.legs[index]);
      leg.setAttribute("stroke-width", `${frame.check.width}`);
      leg.setAttribute("opacity", frame.check.visible ? "1" : "0");
    });
  }

  /** Colours and shape for a moment of the play, or the resting state */
  function show(time: number, delta: number, settings: Settings) {
    const playing = time !== Infinity;
    const look = playing
      ? toggleLook(time, settings)
      : { found: connectedRef.current, checked: connectedRef.current };
    let tile: Tile = "none";
    if (!playing && connectedRef.current) {
      tile = "settled";
    } else if (playing && look.checked) {
      tile = "green";
    }
    light(look.found ? 1 : 0, delta, tile, settings);
    render(toggleFrameAt(time, settings));
  }

  // Frame loop: advance the play, then write attributes straight to the svg
  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();

    function tick(now: number) {
      const delta = Math.min(64, now - lastTime);
      lastTime = now;
      const settings = settingsRef.current;

      if (!settings.freeze) {
        // The scrub effect owns the frame while frozen
        elapsedRef.current += delta * settings.speed;
        const finished =
          elapsedRef.current !== Infinity &&
          elapsedRef.current >= toggleMs(settings);
        if (finished) {
          elapsedRef.current = Infinity;
          connectedRef.current = true;
        }
        show(elapsedRef.current, delta * settings.speed, settings);
      }
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
    // show only touches refs and the settings it's handed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frozen: the scrub slider picks the frame, for stills and slow reveals
  useEffect(() => {
    if (controls.freeze) {
      // A big step so the stroke colour lands at once
      show((controls.scrub / 100) * toggleMs(controls), 1000, controls);
    }
    // show only touches refs and the settings it's handed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  // Autoplay: connect, hold, switch off, rest, forever. Timers run in real
  // time, so slow motion stretches the waits to keep the whole play visible.
  useEffect(() => {
    if (!controls.autoplay || controls.freeze) {
      return;
    }
    let timeout = 0;
    function connect(delay: number) {
      timeout = window.setTimeout(() => {
        connectedRef.current = false;
        toggle();
        const settings = settingsRef.current;
        disconnect(toggleMs(settings) / settings.speed + AUTOPLAY_HOLD_MS);
      }, delay);
    }
    function disconnect(delay: number) {
      timeout = window.setTimeout(() => {
        toggle();
        connect(AUTOPLAY_REST_MS);
      }, delay);
    }
    connect(AUTOPLAY_FIRST_MS);
    return () => window.clearTimeout(timeout);
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
  const pixelSize = 32 * controls.size;

  return (
    <div
      className={cn(styles.canvas, "min-h-screen flex flex-col")}
      style={{ "--bg": theme.bg, "--ink": theme.ink } as CSSProperties}
    >
      <Leva
        hidden={panelHidden}
        titleBar={{ title: "wifi toggle  ·  H to hide" }}
      />

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
            ref={buttonRef}
            type="button"
            aria-label="Toggle wifi"
            onClick={toggle}
            className={cn(
              styles.button,
              "rounded-[48px] outline-none focus-visible:ring-2 focus-visible:ring-current/40",
            )}
            style={{
              color: "var(--icon)",
              transition: "background-color 300ms linear",
            }}
          >
            <svg
              viewBox="0 0 32 32"
              width={pixelSize}
              height={pixelSize}
              className={styles.icon}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              {ARC_PATHS.map((path, index) => (
                <path
                  key={path}
                  ref={(element) => {
                    arcRefs.current[index] = element;
                  }}
                  d={path}
                  pathLength={1}
                />
              ))}
              {CHECK.legs.map((leg, index) => (
                <path
                  key={leg}
                  ref={(element) => {
                    legRefs.current[index] = element;
                  }}
                  d={leg}
                  pathLength={1}
                  opacity={0}
                />
              ))}
              <circle
                ref={dotRef}
                cx={DOT.cx}
                cy={DOT.cy}
                r={DOT.r}
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
}
