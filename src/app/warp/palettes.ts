/**
 * The glow's colours, the same sets as the Blender wallpapers. They are only three colours
 * each: the shaders compute everything else from them, so any other set works just as well.
 */
export type GlowPalette = {
  name: string;
  /** The warm heart of the glow, low in the block */
  core: string;
  mid: string;
  /** The cool rim, high in the block */
  edge: string;
};

export const GLOW_PALETTES: GlowPalette[] = [
  { name: "sunset", core: "#ff8a2e", mid: "#ff3f8a", edge: "#8a5cff" },
  { name: "citrus", core: "#ffc93c", mid: "#ff6a2b", edge: "#ff2d78" },
  { name: "lagoon", core: "#3ee8c8", mid: "#1fa2ff", edge: "#5a4dff" },
  { name: "orchid", core: "#ff7ad9", mid: "#b04dff", edge: "#3f5bff" },
  { name: "aurora", core: "#9bff7a", mid: "#22d3c5", edge: "#7a5cff" },
];
