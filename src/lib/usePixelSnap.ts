"use client";

import { useEffect, type RefObject } from "react";

/**
 * Flex centering can leave an element on a fractional pixel, which blurs
 * crisp SVG strokes inside it. Nudge it onto the device pixel grid using a
 * layout offset (not a transform, which Chrome can rasterize off-grid), and
 * re-snap whenever the container changes size, e.g. on resize or after the
 * page font loads. The element needs `position: relative`.
 *
 * `key` re-runs the snap when it changes, e.g. after the element remounts.
 */
export function usePixelSnap(ref: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const element = ref.current;
    const container = element?.parentElement;
    if (!element || !container) {
      return;
    }

    function snapToPixelGrid() {
      if (!element) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      element.style.top = "";
      element.style.left = "";
      const rect = element.getBoundingClientRect();
      const offsetX = Math.round(rect.left * dpr) / dpr - rect.left;
      const offsetY = Math.round(rect.top * dpr) / dpr - rect.top;
      element.style.left = `${offsetX}px`;
      element.style.top = `${offsetY}px`;
    }

    snapToPixelGrid();
    const observer = new ResizeObserver(snapToPixelGrid);
    observer.observe(container);
    observer.observe(element);
    document.fonts.ready.then(snapToPixelGrid);
    window.addEventListener("resize", snapToPixelGrid);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", snapToPixelGrid);
    };
    // `key` intentionally re-runs the effect after a remount
  }, [ref, key]);
}
