export type Experiment = {
  slug: string;
  title: string;
  description: string;
};

// Newest first. Each slug matches a folder in src/app.
export const experiments: Experiment[] = [
  {
    slug: "warp",
    title: "Warp 3D icon",
    description:
      "Two glass blocks in three.js that tilt with the cursor, in five colours, glossy or frosted.",
  },
  {
    slug: "wifi-toggle",
    title: "Wifi toggle",
    description:
      "A wave, a few loading hops, then the dot lands and grows into a checkmark.",
  },
  {
    slug: "chrome-morph",
    title: "Chrome morph",
    description:
      "A dot splits into three on hover, then morphs into the Chrome logo on click.",
  },
];
