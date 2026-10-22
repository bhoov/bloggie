# Blog

Interactive essays. Built with Astro: posts are MDX, figures are Svelte components, numerics are plain JavaScript.
The goal is low cognitive load for the author: keep everything as close to plain HTML, CSS and
JavaScript as possible, keep like things together, and keep the build to `npm run build`.
The post "How this blog works" (`src/pages/posts/how-this-blog-works/`) is the overview for people deciding
to use the blog: what a reader and an author get, and where each thing is edited. Its deck is the example deck,
written with most slide kinds. The rules are below.

## Where things go

```
src/                                  this blog's own content
  pages/                              one file or folder per URL
    index.astro                       home page: lists every post, newest first
    posts/<slug>/                     one post, everything it needs:
      index.mdx                         the post
      slides.mdx                        its talk deck (optional), at <slug>/slides/
      data/*.json                       figure parameters, imported by the post
      media/                            video and images, imported by the post
      _experiments/                     its Python (optional): generators, runs, tests (see Experiments)
  figures/<figure>/                   one interactive figure, everything it needs:
    <Figure>.svelte                     markup, styles and behaviour
    <figure>.js                         its numerics (plain functions)
    *.test.js                           unit tests of those numerics (see Testing)
    describe.js                         the figure as text, for the agent download
    e2e.js                              its end-to-end check
  figures/shared/                     components used by several figures
  components/slides/                  the pictures of a deck's problem slides
  references.json                     every cited source, keyed by a stable id
  site.js                             site title, author, URL
bloggie/                              Bloggie, the reusable engine (see Bloggie)
  components/Cite.astro               a citation link, checked at build time
  components/Info.astro               an (i) button after a label (a table's column), its note in a popover
  components/LoadDemo.svelte          the "Load demo" cover of a slow demo
  components/slides/                  the slide engine: Slide, Notes, Mark
  layouts/                            the page shell: Base, Post, Slides (rarely edited)
  lib/                                shared JavaScript: math.js, colors.js, citations.js, slides.js,
                                      slide-headings.js, equations.js (equation numbers), roles.js (symbol colors),
                                      toc.js (the table of contents)
  editor/                             the slide editor, `npm run dev` only
  live/                               the live update, `npm run dev` only: a save is drawn without a reload
  styles/site.css                     site-wide styles and the figure kit; slides.css for decks
  scripts/                            check-kit.js, check-colors.js, check-links.js and export-posts.js (run by
                                      `npm run build`), reset.js
  e2e/                                the end-to-end runner: run.js, figures.js, helpers.js, editor.js, live.js, toc.js
bloggie.json                          the paths that are Bloggie: bloggie/ and the files that must stay at the root
astro.config.mjs                      MDX, Svelte, and math settings
AGENTS_reset.md                       this file as `npm run reset` writes it
pyproject.toml, uv.lock               the Python environment: a uv workspace of every post's _experiments/
```

- A post is one folder, `src/pages/posts/<stable-slug>/`: `index.mdx`, its `data/` and `media/`,
  and `slides.mdx` if it has a talk deck. No date prefix in the slug; the date is front matter.
  The home page lists posts automatically, newest first. A post with no tags is part of the main story. Front matter
  `tags: [wip]` puts 🚧 after its title on the home page, and `tags: [archived]` hides it there until the reader checks
  Archived above the list (an appendix that its post links to is archived too); the tags and their marks are `TAGS` in
  `src/pages/index.astro`. Front matter `edited:` is the date of the post's last edit to its text, results or figures;
  set it to the day you make such an edit. The byline shows it after the date, and the home page shows it, and orders
  the posts by it, when the reader checks Last edited. A new post has no tags: write a tag only when the author asks for it, even for a draft or an
  internal post.
- A figure is one folder, `src/figures/<figure>/`, with everything it needs: the `.svelte` component (markup, styles
  and behaviour in one file), its numerics in plain `.js`, their tests, `describe.js` and `e2e.js`.
  Numerics shared by several figures go in `bloggie/lib/math.js`; theme colors in `bloggie/lib/colors.js`.
- `.astro` files are only the page shell: `bloggie/layouts/`, `src/pages/index.astro`, and build-time components in
  `bloggie/components/`. Posts do not need to touch them.
- Site-wide CSS is `bloggie/styles/site.css` (color tokens, typography, the figure kit `.viz`,
  `.controls`, `.fig-*`, `.readout`); a figure's own CSS stays in its `.svelte` file, its slide sizes too.
- Dependencies come from npm through `package.json` and are bundled by Astro; do not add CDN script
  tags. Bump versions deliberately.

## Bloggie: the reusable engine

The blog's engine is **Bloggie**: a post and its talk deck from one folder of plain text. It is the layouts, the slide
kit and editor, the live update, the downloads, the checks and the end-to-end runner. Develop it here, in place, when
a post needs more from it; it stays portable through one boundary:

- Bloggie is the folder `bloggie/`, plus the few files that their tools need at the root of the repository
  (`package.json`, `astro.config.mjs`, the deploy workflow, the slides skill, `AGENTS_reset.md`, `src/pages/index.astro`).
  `bloggie.json` lists them (`kit`) and the site data that Bloggie may read (`site`: `src/site.js`,
  `src/references.json`). A new engine file goes in `bloggie/`. Posts and figures import it as `@bloggie/…`, and a
  post's front matter names its layout as `layout: '@bloggie/layouts/Post.astro'`.
- A Bloggie file imports only other Bloggie files, the site data and npm packages. It never imports a post, a post's
  figure or a slide picture. `npm run build` fails on an import that leaves Bloggie (`bloggie/scripts/check-kit.js`).
- When a post needs a new feature from the engine, build it in Bloggie as a general feature, with no post's names or
  data in it, and use it from the post. Code for one post (a figure, a slide picture such as a maze drawing) stays
  outside Bloggie.

Bloggie's home is `github.com/bhoov/bloggie`. To take a newer Bloggie from a checkout of it, run
`npm run bloggie:pull -- --from <checkout>`: it replaces `bloggie/`, prints how the root files differ (merge those by
hand), and leaves the change to review and commit. To give a change back, open a pull request there against `bloggie/`.

## Working with the author

The author writes the argument; you build and check what it needs. A post goes in this order, and
each step ends with something the author can look at:

1. Outline: the post's question and its sections, one line each, before any prose. Agree on it.
2. Draft: prose in the post's `index.mdx`, one sentence per line, an example beside each idea it
   introduces. Mark each figure the story needs with its tag and a one-line description.
3. Figures: numerics first (plain JS, with the checks Testing allows), then the Svelte component,
   `describe.js`, and `e2e.js`. Report measured numbers, not expected ones.
4. Review: read the post in a browser as a first-time reader and use every control; report bugs,
   unclear or unsupported sentences, and the proposed fix for each. Do not edit the author's prose
   without saying where.
5. Deck: `slides.mdx` beside the post, with the `blog-to-slides` skill (`.claude/skills/`).
6. Check: the unit tests (`node --test`) and `npm run build` pass before anything is committed. Run the end-to-end
   suite (`npm run e2e`, or `npm test` for both) only when the author asks, or after a change that touches
   several figures.

For large pieces (a new post with several figures), split the work by file: one agent for the
numerics, one for the prose, one for the figures, then a reviewer who writes nothing. Each owns its
files; none commits.

The author keeps `npm run dev` open while agents work, so every file you save leaves every page compiling:

- Write a file before the import that needs it: the figure's folder, or the post's `data/*.json`, first, and then its
  import and tag in the post. Under `npm run dev`, an import that fails stays failed after the file appears, until the
  file that imports it is saved again.
- In a file that other posts use (`bloggie/lib/`, `bloggie/layouts/`, `site.css`, `src/figures/shared/`, a figure that two
  posts import), add before you remove: the new export, prop or class goes in beside the old one, every user moves to
  it, and then the old one goes.

A post that does not compile then breaks only its own page, and the posts that share the broken file. The home page
reads each post's front matter as text and imports nothing else of it, so it keeps rendering; keep it that way.

Under `npm run dev` a save does not reload the author's page. The dev server tells each open post to fetch its new
render, and the post swaps in only the blocks of its `<main>` that changed (`bloggie/live/`): the author keeps their place,
and a figure in an unchanged block keeps running. A save of code that the page runs (a figure's `.svelte` or `.js`, a
layout's script), or of anything outside `<main>`, still reloads it; code that only other pages run (another post's
figure) does not. A page script that changes the post's DOM must do the same to the new render, on the `live:render`
event, as `Post.astro` does for citations and heading anchors. A change to `bloggie/live/integration.js` takes effect when
the dev server restarts.

`npm run reset` (bloggie/scripts/reset.js) turns the repo into a clean template and keeps nothing custom: it keeps the
example post `how-this-blog-works` and what it uses, removes every other post, figure, shared figure file, slide
picture and uncited reference, sets the site's title, author and URL, and replaces this file with
`AGENTS_reset.md`. It prints its plan unless given `--yes`. When a rule becomes one that every new blog needs,
add it to `AGENTS_reset.md` too.

## Writing posts

- One complete sentence per line; do not hard-wrap. The author edits with word wrap.
- Lay out the page for the eye, not only for the ear. The look of a page has its own cognitive surface area: a reader
  judges what matters from its shape before reading a word, as Ellen Lupton's *Thinking with Type* teaches with
  hierarchy, contrast and white space. A long paragraph among short ones reads as one to skip, so the passage that
  carries the story must never be the densest block on the screen. Give a load-bearing idea a short paragraph of its
  own, a list (a claim and its parts), a table or a `<p class="standout">`, and let evidence and asides sit in quieter
  paragraphs. Keep one idea to a paragraph and most paragraphs to two to five sentences, and vary their length on
  purpose, so that the reader knows where to slow down. Mark a key term, one the rest of the post depends on, with
  `<dfn>term</dfn>` where it is defined (bold with an amber marker, `site.css`); keep such terms few. The page should
  be pleasing to look at.
- When the text introduces something (a syntax, a rule, a tool), put its working example right
  there, in the same section. Only deliberate foreshadowing may delay it.
- Use a figure as a tag: `<PointerChase client:visible={{ rootMargin: '600px' }} model="transformer" params={pointerChaseParams} />`,
  with the JSON imported at the top of the post. Wrap it in `<div id="…">` when prose links to it. The root margin
  loads the figure's JavaScript a screen before the reader reaches it, so it is drawn and ready when it comes into view.
- Pass a figure only what its first frame needs: Astro writes every prop into the page's HTML. A large file that the
  figure needs only once the reader asks (after "Load demo") is imported with `?url` and passed as its URL, which the
  figure fetches then; the interactive download inlines it (`bloggie/scripts/export/page.js`).
- Cite with `<Cite key="hrm2025">[HRM]</Cite>`; the key must exist in `src/references.json`. On every post a citation
  is a number in order of first use, with the source on hover and a numbered References list at the end. Text in
  brackets becomes the number; other words stay, with the number after them, for a citation that is part of the
  sentence: `<Cite key="trm2025">TRM</Cite> recurses …`. Several sources: `key="hrm2025,trm2025"`.
- Math is `$…$` and `$$…$$`, typeset at build time. Put display `$$` fences on their own lines.
  Do not let an equation scroll sideways in the text column; check the render.
- Write a count of floating-point operations with the unit `flop`, as any SI unit: lowercase, never plural, the prefix
  attached (`551 flop`, `5.0 × 10¹¹ flop`, `12 kflop`), and a rate as `flop/s` (`0.4 Tflop/s`). Never `FLOP`,
  `FLOPs`, `FLOPS` or `flops`. Where a noun is needed, write "floating-point operations" or "flop count" ("1/16 of the
  baseline's flop count"); in math, `$1.2 \times 10^5$ flop` or `\mathrm{flop}`. Code identifiers (a `flops` key) stay.
  See [Stop saying FLOPs](https://htor.inf.ethz.ch/blog/index.php/2026/06/20/stop-saying-flops-a-tiny-rant-about-a-very-real-unit-problem/).
- **One role, one color, everywhere.** Color a math symbol by its role, with the macros of `bloggie/lib/roles.js`:
  `\state{…}` what descent changes (potentials, beliefs, predictions), `\coupling{…}` the weights between units,
  `\given{…}` what the input fixes (tokens, clamps, sources, biases), `\truth{…}` the true answer. Every other symbol
  (indices, constants, step sizes) stays plain. The colors are the same in every post and deck (`--role-*` in
  `site.css`), and a key under the byline names the roles a post uses. Write the role everywhere the post and its deck
  write the symbol: the equation, its legend and the prose. `npm run build` fails on a colored symbol written without
  its role (`bloggie/scripts/check-colors.js`); `node bloggie/scripts/check-colors.js --fix` adds it, and `\plain{…}` keeps one
  appearance plain on purpose. A symbol keeps the role it was last given in its file, so a letter that means something
  new in a later section is colored anew at its first use there.
- MDX rules: comments are `{/* … */}`, tags must close (`<br />`), and `{` `}` outside math and code
  start a JavaScript expression (escape them as `\{ \}` in prose).
- Cross-references: when prose points to another place ("the previous section", "the figure
  below", "the equation above"), make the phrase a link. Give sections a stable id with an HTML
  heading, `<h2 id="setup">…</h2>`, rather than relying on Astro's automatic heading ids.
  `npm run build` fails on an in-page link without a target (`bloggie/scripts/check-links.js`).
- The table of contents lists every `<h2>` and `<h3>` of the post that has an id, in the margin of a wide window and
  in a bar at the top of a narrow one (`bloggie/lib/toc.js`); T toggles it. A post with fewer than three sections has
  none, and front matter `toc: false` hides it. A section heading goes directly in the post (or in its `.addendum`),
  not inside another element.
- Equation and figure numbers, as in Quarto: `\label{eq-id}` on its own line inside a display equation numbers
  it (n); an element whose id starts with `fig-` (`<div id="fig-walk">`) is the next figure, and its caption starts
  with "Figure n." (a CSS counter). An empty link renders its target: `[](#eq-id)` as "Eq. (n)", `[](#fig-id)` as
  "Fig. n". Front matter `equationNumbers: false` turns equation numbering off.
- A post's deck is `slides.mdx` beside it, paired automatically (byline link, S on the post, Esc on
  the deck). In it, `#` is the title slide or a divider and `## [kind] Title` a slide
  (`bloggie/lib/slide-headings.js`); each becomes `<Slide>` (`bloggie/components/slides/`). Follow the
  `blog-to-slides` skill, which ships in `.claude/skills/`.
- Under `npm run dev`, E on a deck turns on the slide editor (`bloggie/editor/`; its keys are listed at the top of
  `client.js`). It writes each change to `slides.mdx` at once: `<Box style="…" inner="…">` around a block, a `style`
  attribute on an element, `titleStyle="…"` in a heading's tag. Keep these when you revise a deck; they are the
  author's layout.

## Figures

- Svelte 5 with runes (`$props`, `$state`, `$derived`, `$effect`); plain JavaScript, no TypeScript.
- Every figure takes `medium` (`'blog'` by default) and puts `data-medium={medium}` on its root. A deck
  passes `medium="slide"` to every figure tag by itself, so a figure can draw a slide version:
  `{#if medium === 'slide'}` for a different layout, and a rule in its own `<style>` under `:global(.slide .demo)`
  for different sizes on a demo slide. A post's figure is unchanged.
- A figure never starts by itself: nothing animates until the reader presses play, in a post and on a slide.
- A figure never makes the page slow. No task on the main thread takes more than about 50 ms: run heavy work in a
  Web Worker (`?worker&inline`), or in slices of at most 8 ms per animation frame. A demo that needs seconds of work
  or large data starts that work only when the reader asks: until then, its first frame shows blurred under a cover
  over its whole interaction, with one large "Load demo" button in the middle, and the controls under it are inert.
- Draw with Svelte SVG markup. Use d3 only for scales, shapes and formats, not for building the DOM. Draw a grid of
  hundreds of cells (a heat map, a board) as one `<path>` per level of opacity, not one element per cell: the page
  hydrates and redraws each element.
- Astro renders each component on the server first: keep `window`, `document`, timers and workers
  inside `onMount`/`$effect`.
- Give each figure a `describe.js` beside its component: `describe(props)` returns the HTML that
  replaces the figure in the agent download (what it shows, its controls, traces from its own
  numerics), and `sources` lists the files to append. Describe a post's video in a
  `<details class="media-description">` under it.
- Give each figure an `e2e.js` beside its component (`bloggie/e2e/figures.js` says what it exports): use the figure through
  its controls and readouts, and assert what the post says it does.
- Load the `dataviz` skill before choosing chart colors or forms.

## Testing

- Never write unit tests after you write code.
- Highly prefer end-to-end tests as the only testing mechanism. Use them to verify that complex
  features work. At the end of an end-to-end run, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could fail, then write the
  code.

In this repo:

- `npm run e2e` builds the site and runs `bloggie/e2e/run.js`: every page in headless Chromium, every figure used through its
  controls (its folder's `e2e.js`), each post's downloads opened as a reader would, each post's table of contents
  (`bloggie/e2e/toc.js`), the slide editor, and the live update. Its artifact is `bloggie/e2e/report/`: `report.json` (each check and
  what it observed, the commit, the browser, a SHA-256 of each download) and a screenshot of each figure. Seed the
  figures, so that a rerun of the same commit gives the same checks and hashes.
- A unit test stays only if it catches a real bug the end-to-end run misses: a gradient against
  finite differences (write it before the gradient), an identity the post states that no figure displays, or inputs a
  reader can choose that the end-to-end run does not try. Delete a unit test the end-to-end run makes redundant.
- Every check has to fail on the bug it is there for. To confirm a new check, plant that bug in a copy
  of the project, and see the check fail.

## Experiments

A post's Python (its data generators, its training runs, the scripts behind its numbers) lives in the post, in
`src/pages/posts/<slug>/_experiments/`. Astro skips a folder whose name starts with `_`, so nothing there becomes a
page, not even a `README.md`.

```
_experiments/
  pyproject.toml          its dependencies; its [project] name is the post's slug
  <package>/              its library, imported by name
  tests/                  its pytest tests (Testing applies: the failures first, then the tests, then the code)
  *.py                    its runs
  runs/                   what the runs write: gitignored
```

- The blog has one Python environment. The root `pyproject.toml` is a uv workspace whose members are every
  `src/pages/posts/*/_experiments`, with one `.venv` and one `uv.lock` at the root (commit the lock). `uv sync`
  installs every post's package, editable; `uv run …` works from any folder of the repo;
  `uv add --package <slug> <dependency>` adds a dependency to one post.
- Write a new post's `_experiments/pyproject.toml` first, before any other file in that folder, and never leave an
  `_experiments/` folder without one: the workspace takes every such folder as a member, and one without a
  `pyproject.toml` stops `uv run` and `uv sync` for every post ("Workspace member … is missing a pyproject.toml").
  If it happens, give that folder its `pyproject.toml` (or move the folder out) rather than editing the root's members.
- A figure never reads `runs/`. A number the post shows is copied from a run into the post's `data/*.json`, and the
  import of that file in the post carries a one-line comment that names the script and the run.
- Python that the post's page runs too is written for MicroPython, and the page runs the same file: the figure imports
  the `.py` as text (`?raw`) and runs it in MicroPython's WebAssembly build (`@micropython/micropython-webassembly-pyscript`
  from npm). Test that each call gives the same result in both runtimes.
- `npm run build` and the deploy workflow run no Python; output that the page needs is committed to `data/`.

## Boundaries

- This directory is self-contained: no path or import may reach outside it. `data/` and `media/` hold committed
  static output only; the script that made them is in the post's `_experiments/` (see Experiments).
- `npm run dev` previews; `npm test` runs the unit tests and then `npm run e2e`; `npm run build` checks Bloggie's boundary and symbol colors,
  builds `dist/` and the downloads, and checks in-page links. `.github/workflows/deploy.yml` builds and deploys to Pages on push to
  `main`; it runs no tests, to stay fast.

## Downloads

The byline's download control offers two single-file copies of each post, which `npm run build` writes
beside it as `dist/posts/<slug>/<slug>.html` and `<slug>-agent.html` (`bloggie/scripts/export-posts.js`). Under
`npm run dev`, `bloggie/scripts/export/dev.js` builds the requested file on the click instead.

- The interactive page (`bloggie/scripts/export/page.js`) inlines the post's styles, fonts, images, video, data and deck,
  and bundles every figure's JavaScript into one inline script, so it works opened from disk. A figure that starts
  a Web Worker must import it with `?worker&inline`, because a separate worker file cannot load from disk.
- The agent download (`bloggie/scripts/export/agent.js`) is text for a language model: math as MathML with its TeX source,
  each figure as its `describe.js` HTML, a video as its `<details class="media-description">`, and the files each
  `describe.js` lists in `sources`. Front matter `agentSummary` states the post's question at the top.
