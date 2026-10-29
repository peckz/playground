# Playground

Motion and interaction experiments by [Petar Cirkovic](https://pettar.com), open source.

## Experiments

| Experiment                           | What it does                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [Wifi toggle](src/app/wifi-toggle)   | A wave, a few loading hops, then the dot lands and grows into a checkmark.   |
| [Chrome morph](src/app/chrome-morph) | A dot splits into three on hover, then morphs into the Chrome logo on click. |

## Running locally

```sh
npm install
npm run dev
```

Then open [localhost:3000](http://localhost:3000). Each experiment has a [leva](https://github.com/pmndrs/leva) panel for tuning it live. Press `H` to hide the panel and `Esc` to go back to the index. Add `?record` to an experiment URL for a clean stage to screen-record: panel hidden, autoplay on.

## Skill

[`svg-icon-animation`](.claude/skills/svg-icon-animation/SKILL.md) is the Claude Code skill these experiments were built with: curves, stroke-dash recipes, bounce physics, what read as cheap and why, and how to check motion frame by frame. Open the repo in [Claude Code](https://claude.com/claude-code) and it loads on its own when you animate an icon.

## License

[MIT](LICENSE)
