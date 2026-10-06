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
    description: "The menu dots spin up and morph into the Chrome logo.",
  },
];
