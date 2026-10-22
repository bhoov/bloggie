# Blog

Interactive essays built with Astro: posts are MDX, figures are Svelte components, numerics are plain JavaScript.
Keep everything close to plain HTML, CSS and JavaScript, keep like things together, and keep the build to
`npm run build`. The post "How this blog works" (`src/pages/posts/how-this-blog-works/`) shows every feature, and its
deck shows most slide kinds; copy from them.

## Comments for the agent

The author writes `((…))` in any file, in plain text or in a comment, to leave a note for you: a question, a request or
a correction. Address each one, then remove it, and say what you did for each. Leave `((IGNORE …))` alone.

## Where things go

```
src/pages/posts/<slug>/        one post: index.mdx, slides.mdx (its deck, optional), data/*.json, media/,
                               _experiments/ (its Python, optional)
src/figures/<figure>/          one figure: <Figure>.svelte, <figure>.js (numerics), *.test.js, describe.js, e2e.js
src/figures/shared/            components that several figures use
src/references.json            every cited source, keyed by a stable id
src/roles.js                   the symbol roles and their colors
src/site.js                    site title, author, URL
bloggie/                       the engine: layouts, components, slide kit and editor, styles, checks, e2e runner
```

- A post's slug is stable and has no date; the date is front matter. The home page lists posts newest first.
  Front matter `tags: [wip]` marks a draft and `tags: [archived]` hides a post; add a tag only when the author asks.
  Set `edited:` to the day you change a post's text, results or figures.
- Site-wide CSS is `bloggie/styles/site.css` (color tokens, the figure kit `.viz`, `.controls`, `.readout`). A
  figure's own CSS stays in its `.svelte` file.
- Dependencies come from npm through `package.json`; no CDN script tags.
- `bloggie/` imports only itself, `src/site.js`, `src/references.json`, `src/roles.js` and npm packages; the build
  fails otherwise (`bloggie/scripts/check-kit.js`). Code for one post stays outside `bloggie/`. A feature that every
  post can use goes in `bloggie/` with no post's names in it.

## Working with the author

The author writes the argument; you build and check what it needs. Work in this order, and stop after each step for
the author to look:

1. Outline: the post's question and its sections, one line each.
2. Draft: prose in `index.mdx`, with a one-line placeholder for each figure.
3. Figures: numerics first, then the component, `describe.js` and `e2e.js`. Report measured numbers.
4. Review: read the post in a browser as a first-time reader, use every control, and list each problem with a fix.
   Do not change the author's prose without saying where.
5. Deck: `slides.mdx`, with the `blog-to-slides` skill.
6. Check: `node --test` and `npm run build` pass before a commit. Run `npm run e2e` when asked, or after a change to
   several figures.

The author keeps `npm run dev` open, so every save must leave every page compiling: write a file before the import
that needs it, and in a shared file add the new export beside the old one before you remove the old one.

## Writing posts

- One sentence per line; no hard wrap.
- Put a working example beside each idea the text introduces. Keep most paragraphs to two to five sentences; give a
  key idea its own short paragraph, list or `<p class="standout">`. Mark a key term with `<dfn>` where it is defined.
- A figure is a tag: `<PointerChase client:visible={{ rootMargin: '600px' }} />`. Pass it only what its first frame
  needs; Astro writes every prop into the HTML.
- Cite with `<Cite key="vaswani2017">[Transformer]</Cite>`; the key must be in `src/references.json`. Text in
  brackets becomes the number; other words stay before it.
- Math is `$…$` and `$$…$$` (fences on their own lines), typeset at build time. `\label{eq-id}` numbers a display
  equation, an id that starts with `fig-` numbers a figure, and `[](#eq-id)` / `[](#fig-id)` render "Eq. (n)" /
  "Fig. n". An equation must not scroll sideways.
- Color each symbol by its role with the macros of `src/roles.js` (`\given{X}`), everywhere the post and its deck
  write it. `npm run build` fails on a colored symbol written without its role; `node bloggie/scripts/check-colors.js
  --fix` adds it, and `\plain{…}` keeps one appearance plain. Add or change roles in `src/roles.js`.
- Give each section an id, `<h2 id="setup">…</h2>`, and make every "the figure below" or "the previous section" a
  link. The build fails on an in-page link without a target. `<h2>` and `<h3>` with ids form the table of contents.
- MDX: comments are `{/* … */}`, tags close (`<br />`), and `{` `}` in prose are escaped as `\{ \}`.
- A deck is `slides.mdx` beside the post: `#` is the title or a divider, `## [kind] Title` a slide. Follow the
  `blog-to-slides` skill. The slide editor (E on a deck under `npm run dev`) writes `<Box style>`, `style` and
  `titleStyle` into `slides.mdx`; keep them when you revise a deck.

## Figures

- Svelte 5 runes, plain JavaScript. Every figure takes `medium` (`'blog'` or `'slide'`) and puts `data-medium` on
  its root.
- A figure never starts by itself, and never blocks the main thread for more than about 50 ms: use a Web Worker
  (`?worker&inline`) or slices of 8 ms per frame. Slow work waits behind a "Load demo" button.
- Draw with Svelte SVG; use d3 for scales, shapes and formats only. Keep `window`, `document`, timers and workers in
  `onMount` or `$effect`.
- `describe.js` gives the figure as text for the agent download; `e2e.js` uses the figure through its controls and
  checks what the post says it does.
- Load the `dataviz` skill before choosing chart colors or forms.

## Testing

- Prefer end-to-end checks (`npm run e2e`: every page, figure, download and deck in headless Chromium; report in
  `bloggie/e2e/report/`). Keep a unit test only for what the end-to-end run cannot see, such as a gradient against
  finite differences.
- A new check must fail on the bug it is for: plant the bug once and see it fail.

## Experiments

A post's Python lives in `src/pages/posts/<slug>/_experiments/` (Astro skips `_` folders), with its own
`pyproject.toml`, written first. The root `pyproject.toml` is a uv workspace of every `_experiments/`; `uv sync`
installs them all. Runs write to `runs/` (gitignored). A number the post shows is copied into `data/*.json`, and its
import carries a comment that names the script and run. The build runs no Python.
