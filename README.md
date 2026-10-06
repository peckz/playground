# Playground

Motion and interaction experiments by [Petar Cirkovic](https://pettar.com), open source.

## Experiments

| Experiment                           | What it does                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [Chrome morph](src/app/chrome-morph) | A dot splits into three on hover, then morphs into the Chrome logo on click. |

## Running locally

```sh
npm install
npm run dev
```

Then open [localhost:3000](http://localhost:3000). Each experiment has a [leva](https://github.com/pmndrs/leva) panel for tuning it live. Press `H` to hide the panel and `Esc` to go back to the index. Add `?record` to an experiment URL for a clean stage to screen-record: panel hidden, autoplay on.

## Adding an experiment

1. Create a folder in `src/app/<slug>` with a `page.tsx`.
2. Put any helpers you share between experiments in `src/lib`.
3. Add it to `src/lib/experiments.ts` and to the table above.

## License

[MIT](LICENSE)
