# Playground

Motion and interaction experiments by [Petar Cirkovic](https://pettar.com), open source.

## Experiments

| Experiment                           | What it does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| [Chrome morph](src/app/chrome-morph) | The menu dots spin up and morph into the Chrome logo. |

## Running locally

```sh
npm install
npm run dev
```

Then open [localhost:3000](http://localhost:3000). Each experiment has a [leva](https://github.com/pmndrs/leva) panel for tuning it live. Press `H` to hide the panel and `Esc` to go back to the index.

## Adding an experiment

1. Create a folder in `src/app/<slug>` with a `page.tsx`.
2. Put any helpers you share between experiments in `src/lib`.
3. Add it to `src/lib/experiments.ts` and to the table above.

## License

[MIT](LICENSE)
