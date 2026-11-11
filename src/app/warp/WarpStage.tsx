"use client";

import { cn } from "@/lib/utils";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { GLOW_PALETTES, type GlowPalette } from "./palettes";
import {
  createGlowIconScene,
  type GlowFinish,
  type GlowIconScene,
} from "./scene";

const FIRST_PALETTE = GLOW_PALETTES[0];
const FINISHES: GlowFinish[] = ["glossy", "frosted"];

/**
 * A palette as a small glass bead: its colours run bottom to top like in the glow block,
 * under a soft highlight, with the rim shaded so it reads as round.
 */
function beadStyle(palette: GlowPalette): CSSProperties {
  return {
    backgroundImage: [
      "radial-gradient(circle at 34% 26%, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0) 42%)",
      `linear-gradient(to top, ${palette.core}, ${palette.mid} 55%, ${palette.edge})`,
    ].join(", "),
    boxShadow:
      "inset 0 1px 1px rgb(255 255 255 / 0.35), inset 0 -4px 7px rgb(0 0 0 / 0.35)",
  };
}

type WarpStageProps = {
  /** Sizes and places the stage: the icon and its colour beads fill whatever box this gives */
  className?: string;
};

/** The live glow icon with its colour beads, leaning towards the cursor */
export default function WarpStage(props: WarpStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GlowIconScene | null>(null);
  const [paletteName, setPaletteName] = useState(FIRST_PALETTE.name);
  const [finish, setFinish] = useState<GlowFinish>("glossy");
  // What is chosen right now, for a scene that finishes loading after the first click
  const chosenRef = useRef({ palette: FIRST_PALETTE, finish });

  useEffect(() => {
    const found = canvasRef.current;
    if (!found) {
      return;
    }
    const canvas: HTMLCanvasElement = found;
    let cancelled = false;

    createGlowIconScene(canvas, FIRST_PALETTE).then((created) => {
      if (cancelled) {
        created.dispose();
        return;
      }
      created.setPalette(chosenRef.current.palette);
      created.setFinish(chosenRef.current.finish);
      sceneRef.current = created;
    });

    // The cursor's place across the stage, from -1 to 1 each way; the scene holds it at
    // the edge once the cursor is past it
    function follow(event: PointerEvent) {
      const box = canvas.getBoundingClientRect();
      sceneRef.current?.pointTo({
        x: ((event.clientX - box.left) / box.width) * 2 - 1,
        y: 1 - ((event.clientY - box.top) / box.height) * 2,
      });
    }

    function rest() {
      sceneRef.current?.pointTo(null);
    }

    window.addEventListener("pointermove", follow);
    document.documentElement.addEventListener("pointerleave", rest);
    window.addEventListener("blur", rest);
    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", follow);
      document.documentElement.removeEventListener("pointerleave", rest);
      window.removeEventListener("blur", rest);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  function finishWith(chosen: GlowFinish) {
    setFinish(chosen);
    chosenRef.current.finish = chosen;
    sceneRef.current?.setFinish(chosen);
  }

  function pick(palette: GlowPalette) {
    setPaletteName(palette.name);
    chosenRef.current.palette = palette;
    sceneRef.current?.setPalette(palette);
  }

  return (
    <div
      className={cn(
        "relative bg-[#050408] [container-type:size]",
        props.className,
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
      {/* Just below the icon, which takes 46% of the stage's short side */}
      <div className="absolute left-1/2 top-[calc(50%+23cqmin+5rem)] flex -translate-x-1/2 flex-col items-center gap-5">
        <div role="radiogroup" aria-label="Glow colour" className="flex gap-4">
          {GLOW_PALETTES.map((palette) => (
            <button
              key={palette.name}
              type="button"
              role="radio"
              aria-checked={palette.name === paletteName}
              aria-label={palette.name}
              onClick={() => pick(palette)}
              style={beadStyle(palette)}
              className={cn(
                "size-7 cursor-pointer rounded-full outline-2 outline-offset-[3px] outline-transparent transition-[outline-color,scale] duration-150 hover:scale-110 focus-visible:outline-white/80",
                palette.name === paletteName && "outline-white/70",
              )}
            />
          ))}
        </div>
        <div role="radiogroup" aria-label="Glass finish" className="flex gap-1">
          {FINISHES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === finish}
              onClick={() => finishWith(option)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-xs capitalize text-white/45 transition-colors duration-150 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-white/80",
                option === finish && "bg-white/10 text-white/90",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
