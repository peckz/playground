---
name: svg-icon-animation
description: Animating inline SVG line icons so they feel premium, with CSS keyframes or a JS frame loop tuned live from Leva (see src/app/wifi-toggle). Pixel-crisp rendering, stroke-dash recipes (draw, lap, centred collapse), path morphs, a dot growing into a checkmark, bounce with real decay, settle/impulse/spring curves, what read as cheap and why, and a frame-by-frame verification workflow. Use when adding or tuning any icon micro-animation, success state, loading state, custom cursor, or velocity-reactive motion.
---

# SVG icon animation

What I learned animating line icons: an icon grid with per-icon hover choreography and a
morphing cursor, a velocity-reactive bell, and several wifi icons that ended up as this
repo's [wifi toggle](../../../src/app/wifi-toggle) (search, load, connect). Read this before
building anything similar.

Two ways to build, pick by the play:

- **CSS keyframes**: a single hover beat per icon, restarted by remounting.
- **JS frame math** (`src/app/wifi-toggle`): several beats that hand off (wave, hops, lap,
  checkmark, return), settings tuned live, plays that overlap. See "Frame-driven studios"
  below and `reference/frame-driven-motion.md`, which holds the curves, stroke and shape
  recipes, bounce physics, choreography and what got rejected.

## Where things live

| Path                                       | What                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/app/wifi-toggle/WifiToggleStudio.tsx` | frame-driven studio: one rAF loop, Leva panel, autoplay, freeze/scrub, `?record` |
| `src/app/wifi-toggle/toggleMotion.ts`      | the play: wave, loading hops, then the lap into a checkmark                      |
| `src/app/wifi-toggle/wifiMotion.ts`        | icon geometry, the lap and the wave swell                                        |
| `src/app/wifi-toggle/successMotion.ts`     | lines lap out, the dot hops onto the corner and grows legs, all comes home       |
| `src/app/wifi-toggle/hopMotion.ts`         | the even loading hops with squash and stretch                                    |
| `src/app/wifi-toggle/motion.ts`            | shared easing: `cubicBezier`, `clamp`, `lerp` and friends                        |
| `src/lib/usePixelSnap.ts`                  | nudges a container onto the device pixel grid                                    |
| `reference/frame-driven-motion.md`         | everything about frame-driven motion, in detail                                  |
| `reference/pulse_keyframes.py`             | keyframe generator for a wave travelling down an outline (path morph)            |

## Architecture conventions (CSS keyframes)

- Parts that move independently get their own `<g>`. Give groups `transform-box: fill-box`
  once, so `transform-origin: 50% 100%` means the bottom of that part. When an origin must be
  a viewBox coordinate (a hem line, a pivot outside the shape) override with
  `transform-box: view-box; transform-origin: 24px 40.114px`.
- Restart on every hover by remounting: render `<div key={playCount} className={cn(styles.stage, playCount > 0 && styles.play)}>`
  around the svg, and scope every rule to `.play .partName`. The stage is an HTML box on
  purpose: it is the only element that can take 3D transforms (see below).
- One shared clock per icon. Every part's animation has the same duration and `linear`, with
  easing set per keyframe via `animation-timing-function` inside the keyframe. That is what
  lets beats across parts line up exactly.
- Every animation must end on identity (`transform: none`, `stroke-dashoffset: 0`, original
  `d`) so the resting icon is pixel-identical. Use `both` fill only when a delayed part must
  hold its 0% frame before starting.
- A reduced-motion block disables the plays. Anything animated on a `path` directly (dash
  draws, `d` morphs) has to be listed there too.

## Pixel-crisp rendering

Strokes broke on half pixels more than once. The fixes, all required:

1. Render the viewBox at exactly its size or an integer multiple (a 32-unit icon at 192 or
   256px). Rendering 48 units at 56px puts every 2px stroke off-grid.
2. Snap the container with **layout** offsets (`style.top/left`), never `transform: translate`.
   Chrome rasterizes fractional transforms off-grid even when the result would be whole pixels.
   `usePixelSnap` does this, dpr-aware, on ResizeObserver (element and parent),
   `document.fonts.ready` (font load shifts layout after mount) and resize.
3. Round hover drift toward the cursor to whole pixels before applying it.
4. Parked positions inside an animation use whole-pixel translates.
5. A group at exactly `scale(0)` is a degenerate matrix and Chrome skips painting it. Bottom
   out at `0.02`. Same for `rotateX(90deg)`: use 88.

## Stroke-dash recipes (all assume `pathLength={1}`)

- **Draw-in without the 1px dot.** Round caps paint a dot at a zero-length dash. Use
  `stroke-dasharray: 1 2; stroke-dashoffset: 1.1` and animate the offset to 0.
- **Lap.** `stroke-dasharray: 1 gap`, offset 0 to `-(1 + gap)`: the line slides off the right
  end and the next one comes in from the left, landing where the first started.
- **Retract and redraw a segment**: the same `1 2` pattern, offset 0 to 1.1 to retract, 1.1 to
  0 to redraw, with a dead pause between.
- **Centred visible segment** of length L on a closed or symmetric path:
  `stroke-dasharray: L 1; stroke-dashoffset: L/2 - 0.5`. Both values interpolate linearly so
  they stay in sync.
- **Rest is `dasharray: none`**, not `1 0`, which can still show seams.

## Path morphs (SMIL `<animate attributeName="d">`)

Safari can't animate CSS `d` at all, so a CSS `d` morph silently skips there. Use SMIL, which
morphs in both: `<animate attributeName="d" values="a;b;..." keyTimes="..." begin="indefinite" fill="remove">`
inside the path. Call `beginElement()` on every `animate[begin='indefinite']` in a layout
effect after the stage remounts, so the morph shares the CSS parts' clock. Reduced motion
skips that call.

- Safari pauses the SMIL clock in a background tab; bring it to the front before measuring.
- To scrub SMIL: `svg.pauseAnimations(); svg.setCurrentTime(animate.getStartTime() + seconds)`.
- Every keyframe needs the identical command list. Straight runs become collinear cubics
  (`C10 34.5 10 32 10 26.5`), which rasterize exactly like a line at rest.
- Seams between separate paths need **vertical end tangents** at the seam, or the bend shows
  as a kink. Pin the control point straight above or below the endpoint.
- When two paths must stay joined while one morphs, derive the other's transform from the
  same math.
- Generate keyframes with a script instead of by hand (`reference/pulse_keyframes.py`).
  Dense sampling (every 4%) is what makes a linearly interpolated morph look fluid.
- The rest state must be the plain icon: assert the generated 0% path equals the JSX `d`.

## Motion path (`offset-path`)

Chrome anchors the element's corner to the path unless you set both `offset-anchor: 50% 50%`
and `transform-origin: 50% 50%` explicitly. Set `offset-rotate: 0deg`. Provide a
`@supports not (offset-path: path("M0 0 L1 1"))` fallback with a plain translate.

## 3D and perspective

- Inner SVG elements are flattened: `rotateX` on a `<g>` is just `scaleY(cos)` with no
  perspective. Only the outer HTML box can do real 3D.
- Put `perspective()` inside the transform (`transform: perspective(200px) rotateX(88deg)`)
  rather than on the parent. That puts the vanishing point at the element's
  `transform-origin`, so a hinge above the icon keeps the near edge from drifting past the fold.
- 200px perspective is right for a 48px element; 100px is fisheye, 400px is flat.
- Chrome rasterizes the svg, then transforms the texture, so expect blur near edge-on.
- A 3D cloth flip read as rigid and was replaced by a 2D wave. Keep 3D for card-like things.

## Timing principles that read as premium

- **Anticipation**: a 60-80ms micro-squash before a move.
- **Ballistic moves** (saccades, whips): 160-180ms with a sharp ease-out and a small
  overshoot, then a **moving hold**: keep drifting 1-2% during a dwell so nothing freezes.
- **Blink**: close fast (90ms, ease-in), open cushioned (130ms, 5% overshoot).
- **Uneven beat spacing**: 590ms, then 550ms, then a 280ms dead pause. Equal beats feel
  mechanical.
- **Hops** share one shape: squash 15%, peak at 40-45% with a slight stretch, land at 65-70%
  with a squash, settled by 85%.
- **Damped bounce** for anything settling: `A * exp(-q/tau) * sin(pi*q/T)`, with the end forced
  to exactly 0.
- Per-phase easings that worked: launch `cubic-bezier(0.2, 0.6, 0.35, 1)`, gravity fall
  `cubic-bezier(0.55, 0, 0.85, 0.4)`, glide/park `cubic-bezier(0.22, 1, 0.36, 1)`, whip
  `cubic-bezier(0.5, 0, 0.7, 0.3)`.
- Asked for "more drastic"? Double the amplitude before touching the duration. "Too fast"?
  Split the difference numerically and offer both.
- Cartoon physics beats realism. Light things go up fast, come down slower, and decay quickly.

## Frame-driven studios

The short version of `reference/frame-driven-motion.md`:

- `*Motion.ts` is pure: `frameAt(time, settings)`, ms in, attribute strings out. `Infinity`
  means at rest. One rAF loop writes to refs, settings come through a ref, one clock per play.
- Curves: the lap is `cubic-bezier(0.65, 0, 0.15, 1)` (slow start, kick, long settle). Exits
  accelerate (`0.32, 0, 0.67, 0`). Entrances use an exponential `settle`. Swells use a
  critically damped impulse with a 700 to 900ms tail. A bloom uses an underdamped spring at
  damping 0.65, about 6% overshoot. Force every asymptotic curve to land exactly on rest.
- Strokes: lap = dash `1 gap` shifted by `1 + gap`; wipe/draw = tail/head stretch;
  collapse = centred dash. Rest is `dasharray: none`. Empty dashes still paint their caps.
- A dot grows into a checkmark when the legs' round caps start out as the dot. Hide arcs by
  growing an opaque badge over them, never by fading.
- Bounces decay: each hop half the time and a quarter the height, with a squash on each
  impact. Loading hops are the exception: even height, so they read as waiting.
- Stagger 55 to 80ms, no dead air between beats, and the return mirrors the exit.
- Colour: snap the strokes between states rather than fading them; a background tint can
  change on a plain linear transition.

## Velocity-reactive motion

- Read pointer speed from a 120ms sample window.
- Map velocity 1-8 px/ms to swing angle, duration and swing count, with a floor high enough
  that a slow hit still rings properly (14deg, 900ms, 2.5 swings).
- Drive with WAAPI (`element.animate`) so a new hit cancels the old one. Simulated pointer
  flights use quadratic ease-in then ease-out beziers (`cubic-bezier(0.333, 0, 0.667, 0.333)` /
  `(0.333, 0.667, 0.667, 1)`), so impact velocity equals the preset: time = 2d / v.

## Custom cursor

A single `position: fixed` element, `translate(x,y) translate(-50%,-50%)`, with transitions on
width, height and border-radius, and `corner-shape: superellipse(1.6)` as progressive
enhancement. Hide the native cursor with `.canvas, .canvas * { cursor: none }` under
`@media (hover: hover)`: buttons and links set their own cursor in the UA stylesheet, so the
descendant selector is required.

## Verifying frame by frame in Chrome

Never trust a description of motion. Record it or scrub it.

- **Frame-driven plays**: record the real DOM into a strip (script in
  `reference/frame-driven-motion.md`), then screenshot the strip.
- **CSS keyframes**: pause and scrub with WAAPI:

```js
const cell = document.querySelector("button");
cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); // React onMouseEnter listens to mouseover
await new Promise((r) => setTimeout(r, 80));
const anims = cell.getAnimations({ subtree: true });
anims.forEach((a) => {
  a.pause();
  a.currentTime = 440;
}); // then zoom-screenshot the cell
anims.forEach((a) => a.finish()); // leave it at rest
```

- Read computed transforms (`getComputedStyle(el).transform`) and positions
  (`getBoundingClientRect`) to check numbers, not just pictures.
- Background tabs pause rAF: wait with `setTimeout`, not a rAF loop, or the call hangs.
- Hot reload drops paused animations and cached element handles, and sometimes keeps the old
  motion module. Re-query after every edit, and reload if frames don't match the code.
- After scripted edits, check the page still returns 200, then run `npx eslint src` and
  `npx tsc --noEmit -p .`.

## Process notes

- Load a motion-principles reference (a premium-motion skill if you have one) before
  designing timing, and build on its curves instead of guessing.
- Ship a working version fast on the dev server, then tune from what people say when they
  see it. Words like "cheap", "aliexpress" or "like a bang" map to specific fixes in
  `reference/frame-driven-motion.md`.
- For feel and timing research (principles, references, numbers), a subagent can dig while
  you wire the plumbing.
