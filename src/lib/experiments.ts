export type Experiment = {
  slug: string;
  title: string;
  description: string;
};

// Newest first. Each slug matches a folder in src/app.
export const experiments: Experiment[] = [
  {
    slug: "chrome-morph",
    title: "Chrome morph",
    description:
      "A dot splits into three on hover, then morphs into the Chrome logo on click.",
  },
];
