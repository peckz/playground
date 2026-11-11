# Warp 3D icon

The [Warp](https://www.warp.dev) icon as two glass blocks on a dark plate: one clear, one lit from within. Made in Blender over a weekend, then rebuilt in three.js so it runs live in the browser. The write-up is at [pettar.com/work/warp](https://pettar.com/work/warp).

Everything here is free to download and use under the repo's [MIT license](../LICENSE). The Warp name and logo are trademarks of Warp.

## What's here

| Folder                               | What it is                                                                |
| ------------------------------------ | ------------------------------------------------------------------------- |
| [`wallpapers/`](wallpapers)          | 2560 x 1440 renders in five colours, each with a frosted and glossy block |
| [`blender/`](blender)                | The two Blender scenes and the scripts that render them                   |
| [`../src/app/warp`](../src/app/warp) | The three.js version: tilts with the cursor, five colours, two finishes   |

## Wallpapers

Named `2k-<colour>-<finish>.png`, in a folder per colour: `sunset`, `citrus`, `lagoon`, `orchid`, `aurora`.

## Blender files

Made with Blender 5.2, rendered with Cycles.

- `frosted.blend`: the clear block is sanded, so it blurs the glow behind it
- `glossy.blend`: both blocks are polished, lit by softboxes that only show in reflections

Opening a file and pressing render gives the sunset colours with Blender's own colour output. The wallpapers go through `render.py`, which adds the output curve (exposure, contrast, a soft shoulder), and `recolour.py`, which swaps the glow's colours:

```sh
cd warp/blender

# Sunset, as saved in the file
blender -b frosted.blend -P render.py -- out.png 2560x1440 1024

# Another colour
GLOW_PALETTE='{"glowCore": "#3ee8c8", "glowMid": "#1fa2ff", "glowEdge": "#5a4dff"}' \
  blender -b glossy.blend -P recolour.py -P render.py -- out.png 2560x1440 1024 0.5 --grain 0.008
```

The arguments after `--` are the output file, the size, the samples and the icon's share of the frame. The glossy wallpapers use `--grain 0.008`, a trace of grain that keeps the dark gradients from banding.

The colours, from the glow's core to its edge:

| Colour | Core      | Mid       | Edge      |
| ------ | --------- | --------- | --------- |
| sunset | `#ff8a2e` | `#ff3f8a` | `#8a5cff` |
| citrus | `#ffc93c` | `#ff6a2b` | `#ff2d78` |
| lagoon | `#3ee8c8` | `#1fa2ff` | `#5a4dff` |
| orchid | `#ff7ad9` | `#b04dff` | `#3f5bff` |
| aurora | `#9bff7a` | `#22d3c5` | `#7a5cff` |

`build_scene.py` is the script the frosted scene was first built from. `recolour.py` borrows its glow colour formula; you don't need to run it.

## three.js version

Run the repo (`npm install`, `npm run dev`) and open [localhost:3000/warp](http://localhost:3000/warp). Only the three meshes come from Blender (`public/warp/warp-icon.glb`); the light is computed live:

- `scene.ts`: the scene, the studio reflections, the tilt, and the glossy and frosted glass
- `shaders.ts`: the glow inside its block, soft shadows, and the glow pooling on the plate
- `glowField.ts`: the glow's colour map, repainted when the colour changes
- `palettes.ts`: the five colours
