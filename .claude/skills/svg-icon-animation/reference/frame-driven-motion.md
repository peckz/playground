# Frame-driven SVG motion

Learned building the wifi icons that became the [wifi toggle](../../../../src/app/wifi-toggle):
three versions in a private playground (a lap with a hopping checkmark, a bounce into a green
badge, and a lap into the badge), then this repo's toggle, which combines the best parts.
The end results were called "exceptional" and "super premium".
They also called earlier attempts "aliexpress" and "animation class from high school", so the
"Rejected" section matters as much as the recipes.

Use this approach instead of CSS keyframes when a play has several beats that hand off to each
other (exit, hop, bloom, return), when beats depend on settings, or when you will tune
the motion live from a Leva panel.

## Studio architecture

Copy `src/app/wifi-toggle/WifiToggleStudio.tsx`. The pieces:

- **Pure frame math in `*Motion.ts`.** `frameAt(time, settings) => Frame` with no DOM and no
  state. Times are ms. Pass `Infinity` for a play that isn't running. Every function clamps,
  so `Infinity` reads as "finished, at rest" and there is no separate rest frame.
- **One rAF loop** advances `elapsedRef += delta * speed` and writes attributes straight to
  refs (`setAttribute("stroke-dasharray", ...)`). React never re-renders per frame. Cap
  `delta` at 64ms so a background tab doesn't jump.
- **Settings through a ref.** `settingsRef.current = controls` in an effect, so tweaking Leva
  never restarts the loop.
- **Several plays at once.** Keep one clock per play (`{ lap, wave, success }`) so hover and
  click can overlap. A play that moves the same element as another blocks it while it runs.
- **No restart mid-play.** A trigger while the play is running is ignored, so nothing ever
  jumps back to frame 0.
- **Studio kit** shared by every playground: its own `useCreateStore()` (Leva's global store
  leaks values between pages), `freeze` + `scrub` for stills, `autoplay` that stands in for
  a visitor (hover, a beat, click, hold), speed 1x/0.5x/0.25x, themes as `--bg`/`--ink`
  inline vars, H hides the panel, `usePixelSnap`, reduced motion skips the play.
- **Hover is mouse only.** `onPointerEnter` checks `event.pointerType === "mouse"`, so a tap on
  touch is just the click.
- A Leva `button(() => play())` that reads refs trips `react-hooks/refs`. Suppress it with a
  comment saying Leva only calls it on click.
- A Leva folder and a control with the same name collide. Name folders by trigger
  ("wave on hover", "lap on click").

## Curves

All in `src/app/wifi-toggle/motion.ts` or the wifi motion files next to it.

| Use                                                    | Curve                                                |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Lap, the favourite: slow start, hard kick, long settle | `cubic-bezier(0.65, 0, 0.15, 1)`                     |
| Exit: accelerate and cut at peak speed                 | `cubic-bezier(0.32, 0, 0.67, 0)`                     |
| Entrance: full speed at 0, settles                     | exponential `settle(t, tau, length)`, tau 70 to 95ms |
| Swell (grow and come home)                             | critically damped impulse, below                     |
| Bloom with one overshoot                               | underdamped spring, damping 0.65 gives about 6%      |
| Rise against gravity into an apex                      | `cubic-bezier(0.2, 0.6, 0.35, 1)`                    |
| Crouch / squash in                                     | `cubic-bezier(0.3, 0, 0.2, 1)`                       |

```ts
// Full speed at 0, slowing by the same fraction every ms, lands exactly on 1 at `length`
function settle(time: number, tau: number, length: number) {
  return (
    (1 - Math.exp(-clamp(time, 0, length) / tau)) /
    (1 - Math.exp(-length / tau))
  );
}

// 0 -> 1 at `peak` -> long exponential tail. No corner at the peak, unlike up-then-down beziers.
function impulse(time: number, peak: number) {
  const ratio = time / peak;
  return ratio * Math.exp(1 - ratio);
}
// Force the tail to land on exactly 0 at `length`: impulse(t) - impulse(length) * (t / length)

// Underdamped spring 0 -> 1 with its first peak at `peakMs`, forced onto 1 at `length`
function spring(time: number, damping: number, peakMs: number, length: number) {
  const damped = Math.PI / peakMs;
  const decay = damping * (damped / Math.sqrt(1 - damping * damping));
  const raw = (at: number) =>
    1 -
    Math.exp(-decay * at) *
      (Math.cos(damped * at) + (decay / damped) * Math.sin(damped * at));
  const local = clamp(time, 0, length);
  return raw(local) + (1 - raw(length)) * (local / length);
}
```

Every curve that never quite arrives (exponentials, springs) gets the same trick: add the
leftover linearly so it lands exactly on its end value at `length`. The rest frame must be
pixel-identical to the source icon.

## Stroke recipes (all `pathLength={1}`)

- **Lap (a line rolls through itself).** `stroke-dasharray: 1 gap`, offset from 0 to
  `-(1 + gap)` on one curve. The line slides off the right while the next one comes in from
  the left and lands exactly where the first started. Gap 0.5 is the default. The line is
  briefly empty at the fastest moment, so the eye never sees the hole.
- **Stretch from tail to head.** `dasharray: ${head - tail} 2`, `dashoffset: -tail`. Tail 0 to 1
  wipes a line off left to right; head 0 to 1 draws it in. That is the first and second half
  of a lap, and they can be split around another beat (the success plays).
- **Centred collapse / grow.** `dasharray: ${drawn} 1`, `dashoffset: drawn / 2 - 0.5`. Both ends
  pull into the middle (exit) or grow out of it (entrance).
- **Empty dash.** A zero-length dash still paints a round cap. Park it past the end
  (`dasharray: 0 2; dashoffset: -1.5`) or set opacity 0. Never leave `0 x` at offset 0.
- **Rest is `dasharray: none`.** Not `1 0`, which can still show seams.

## Shape recipes

- **Dot becomes a checkmark.** Two leg paths start at the corner, each `pathLength={1}`. At
  dash 0 their round caps paint a dot, so with `stroke-width` equal to the dot's diameter
  (4 for r 2) the swap from circle to legs is invisible. Grow the dashes with `settle` and
  lerp the stroke width down to the line weight as they grow. The long leg trails by 30ms,
  like a hand drawing it.
- **Badge that hides the arcs.** Instead of fading or wiping lines away, grow an opaque circle
  over them. For this icon, radius 13.5 at (16, 16) covers every arc including its caps
  (outer tips are 12.4 from the centre, plus 1 for the cap). Measure; 12.5 left tips poking out.
- **Colour.** `color-mix(in oklab, var(--green) N%, var(--ink))` on the element's `color`, with
  `fill="currentColor"`. Black to green passes through dark green, so finish the mix within
  about 80ms of the growth starting. On the way home, stay green until about 80% of the way back
  to dot size. A big ink-coloured blob over the lines reads as a mistake.
- **A dot crossing lines of the same colour merges with them.** Turn it the accent colour on the
  way (it greened during its jump in v2).
- **Scale around the dot** with `translate(cx cy) scale(s) translate(-cx -cy)`. Empty string at
  scale 1.
- **Squash pinned to the base**: translate to `cy + r`, scale `(1 + 0.8a, 1 - a)`, translate back.

## Bounce

Real decay reads premium; a fixed wobble reads cheap.

- Hops back to back, each `HOP_DECAY = 0.5` of the last one's duration, so a quarter of its
  height. Three hops: 320, 160, 80ms.
- Height is a parabola in linear time (`4h * p * (1 - p)`). Linear time is what makes it
  ballistic.
- Squash at every touchdown, scaled by the impact (`0.32 * 0.5^n`) over a window that shrinks
  with it. Stretch in flight in proportion to speed, `|1 - 2p|`, strongest leaving and meeting
  the ground.
- 70ms crouch before the first hop (anticipation). Snapping from the squash straight into the
  take-off stretch on one frame is the classic squash and stretch, and it is what reads as springy.
- Keep the hop under neighbouring shapes unless they are gone (2.5 units under the inner arc
  in v2, 4 once the lines have left in v3).

## Choreography that landed

- **One composition, light stagger.** 55 to 80ms between arcs. The lap stagger can run from the
  bottom (inner arc) or the top (outer), and both are worth having as a setting.
- **Beats hand off without dead air.** The badge starts growing as the dot comes to rest, and
  the lines start coming back 120ms after the badge starts shrinking. A gap of 300ms or more
  between beats read as disconnected every time.
- **Symmetric return.** Whatever left comes back the opposite way: wiped right, drawn in from
  the left; collapsed into the middle, grown out of it.
- **A hold of 500 to 600ms** on the success state, then everything heads home.

## Rejected (and why)

- Comet laps that keep circling, three or more passes: "too much moving in circle".
- Inner-first stagger with ease-in entrances and a slow colour fade: "aliexpress".
- Every line hitting a wall and springing: "animation class from high school".
- Turning the arcs into an exclamation mark: "too complex". Fewer beats, each one finished.
- A swell that went up and down on beziers in 360ms: "settles too quickly, like bang". The
  impulse with a 700 to 900ms tail fixed it.

## Checking a play

Record the real DOM, don't trust the math alone:

```js
const svg = document.querySelector("main button svg");
const frames = [];
document.querySelector("main button").click();
const t0 = performance.now();
await new Promise((resolve) => {
  (function loop() {
    const t = Math.round(performance.now() - t0);
    if (!frames.length || t - frames.at(-1)[0] >= 45) {
      const clone = svg.cloneNode(true);
      // computed colour, since color-mix and vars don't survive outside the page
      clone.querySelector("circle").style.color = getComputedStyle(
        svg.querySelector("circle"),
      ).color;
      frames.push([t, clone.outerHTML]);
    }
    t < 2500 ? requestAnimationFrame(loop) : resolve();
  })();
});
// lay the frames out in a fixed strip, zoom-screenshot it, then remove the strip
```

- Simulate hover with `new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })`.
  React's `onPointerEnter` listens to `pointerover`.
- Hot reload sometimes keeps the old motion module. If frames don't match the code, reload.
- For curves, run the motion module in node with `npx tsx` and print values over time:
  overshoot, settle time, and that the end lands exactly on rest.
