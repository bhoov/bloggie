# Blog

Interactive essays built with Astro: posts are MDX, figures are Svelte components, numerics are plain JavaScript.
Keep everything close to plain HTML, CSS and JavaScript, keep like things together, and keep the build to
`npm run build`. The post "How this blog works" (`src/pages/posts/how-this-blog-works/`) shows every feature, and its
deck shows most slide kinds; copy from them.

## Comments for the agent

The author writes `((…))` in any file, in plain text or in a comment, to leave a note for you: a question, a request or
a correction. Address each one, then remove it, and say what you did for each. Leave `((IGNORE …))` alone. A `((…))` inside
inline code or a code block is an example, as in this file, not a note.

## Where things go

```
src/pages/posts/<slug>/        one post: index.mdx, slides.mdx (its deck, optional), data/*.json, media/
src/figures/<figure>/          one figure: <Figure>.svelte, <figure>.js (numerics), describe.js, e2e.js
src/figures/shared/            components that several figures use
src/references.json            every cited source, keyed by a stable id
src/roles.js                   the symbol roles and their colors
src/site.js                    site title and author (and URL, for a host other than GitHub Pages)
node_modules/bloggie/          the engine, Bloggie, an npm package (in a blog made with --git, a link to bloggie/)
```

- A post's slug is stable and has no date; the date is front matter. The home page lists posts newest first.
  Front matter `tags: [wip]` marks a draft and `tags: [archived]` hides a post; add a tag only when the author asks.
  Set `edited:` to the day you change a post's text, results or figures.
- Site-wide CSS is `node_modules/bloggie/styles/site.css` (color tokens, the figure kit `.viz`, `.controls`, `.readout`). A
  figure's own CSS stays in its `.svelte` file.
- Dependencies come from npm through `package.json`; no CDN script tags.
- Import the engine's code as `bloggie/…` (`import { series } from 'bloggie/lib/colors.js'`) and its components and
  layouts as `@bloggie/…`. Code for one post or figure stays in `src/`. Never edit `node_modules/bloggie/`: npm
  replaces it. `node_modules/bloggie/AGENTS.md` has the engine's rules.
- `npm run bloggie:update` installs the latest Bloggie. Never force-push, and never rewrite history that is already
  pushed.

### Suggesting a change to Bloggie

When you find a bug in Bloggie, or a feature that any blog could use, offer the author to send a fix to Bloggie as a
pull request. Send it only once the author agrees: the commit message, the description and the code are public.

In a blog that uses Bloggie as an npm package (`package.json` lists `bloggie` as a dependency), make the change in a
clone of Bloggie: `gh repo fork bhoov/bloggie --clone`, change it there, check it in a starter blog made from the clone
(`node scripts/create.js ../check --copy-engine`, then `npm run build` in `../check`), and open the pull request with
`gh pr create`. The steps below are for a blog made with `--git`, whose engine is its own `bloggie/` folder
(`package.json` lists `bloggie` under `workspaces`); there `npm run bloggie:update` merges Bloggie's main into
`bloggie/` (commit first, and resolve a conflict as any merge conflict).

1. Keep the change general: no post's names, data, unpublished results or private paths (`bloggie/AGENTS.md`).
2. Commit the change to `bloggie/` in this blog, then run `npm run bloggie:update` (it refuses while `bloggie/` has
   uncommitted changes). Everything in `bloggie/` that differs from Bloggie's main goes into the pull request, so check
   the list in step 3.
3. `npm run bloggie:push -- -m "Title" --body "What it does, why, and how you checked it"`: it lists the files that
   would change and sends nothing. Show the list to the author.
4. Add `--yes`. With the GitHub CLI (`gh`, logged in) it makes the author's fork if needed, pushes one commit to a new
   branch of it and opens the pull request; it prints the link. Without `gh`, fork `github.com/bhoov/bloggie`, add
   `--remote <the fork's URL>`, and open the pull request from the link it prints.

It sends only the content of `bloggie/`, never this blog's commits. Do not use `git subtree push`.

## Working with the author

The author writes the argument; you build and check what it needs. Work in this order, and stop after each step for
the author to look:

1. Outline: the post's question and its sections, one line each.
2. Draft: prose in `index.mdx`, with a one-line placeholder for each figure.
3. Figures: numerics first, then the component, `describe.js` and `e2e.js`. Report measured numbers.
4. Review: read the post in a browser as a first-time reader, use every control, and list each problem with a fix.
   Do not change the author's prose without saying where.
5. Deck: `slides.mdx`, made by the `bloggie-slides` skill. Read `.agents/skills/bloggie-slides/SKILL.md` before you make,
   revise or check a deck; its `check-slides.mjs` checks every slide with nothing to install.
6. Check: `npm run build` passes before a commit. Run `npm run e2e` when asked, or after a change to
   several figures.

The author keeps `npm run dev` open, so every save must leave every page compiling: write a file before the import
that needs it, and in a shared file add the new export beside the old one before you remove the old one.

## Writing posts

- When writing posts and slides, prefer one sentence per line, and do not hard-wrap: editors wrap long lines, and a
  diff then shows which sentence changed.
- Put a working example beside each idea the text introduces. Keep most paragraphs to two to five sentences; give a
  key idea its own short paragraph, list or `<p class="standout">`. Mark a key term with `<dfn>` where it is defined.
- A figure is a tag: `<AttentionWalk client:visible={{ rootMargin: '600px' }} />`. Pass it only what its first frame
  needs; Astro writes every prop into the HTML.
- Cite with `<Cite key="vaswani2017">[Transformer]</Cite>`; the key must be in `src/references.json`. Text in
  brackets becomes the number; other words stay before it.
- Math is `$…$` and `$$…$$` (fences on their own lines), typeset at build time. `\label{eq-id}` numbers a display
  equation, an id that starts with `fig-` numbers a figure, and `[](#eq-id)` / `[](#fig-id)` render "Eq. (n)" /
  "Fig. n". An equation must not scroll sideways.
- Color each symbol by its role with the macros of `src/roles.js` (`\given{X}`), everywhere the post and its deck
  write it. `npm run build` fails on a colored symbol written without its role; `node node_modules/bloggie/scripts/check-colors.js
  --fix` adds it, and `\plain{…}` keeps one appearance plain. Add or change roles in `src/roles.js`.
- Give each section an id, `<h2 id="setup">…</h2>`, and make every "the figure below" or "the previous section" a
  link. The build fails on an in-page link without a target. `<h2>` and `<h3>` with ids form the table of contents.
- MDX: comments are `{/* … */}`, tags close (`<br />`), and `{` `}` in prose are escaped as `\{ \}`.
- A deck is `slides.mdx` beside the post: `#` is the title or a divider, `## [kind] Title` a slide. Follow the
  `bloggie-slides` skill. The slide editor (E on a deck under `npm run dev`) writes `<Box style>`, `style` and
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

- Keep unit tests to a minimum. Check a figure through its `e2e.js` (`npm run e2e`: every page, figure, download and
  deck in headless Chromium; report in `node_modules/bloggie/e2e/report/`). Write a unit test only for what the end-to-end run
  cannot see, such as a gradient against finite differences, and only when the author agrees.
- A new check must fail on the bug it is for: plant the bug once and see it fail.
