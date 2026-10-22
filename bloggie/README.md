# Bloggie

Write one story with your AI agent. Publish it as an interactive blog post that ports to slides when you need them.

Bloggie turns one plain-text story into an interactive blog post and, when you want it, a talk deck that runs the same
live figures. Every post also downloads as a single HTML file that works offline.

- **One story, two forms.** A post, plus an optional slide deck beside it that reuses its figures and tables.
- **Live figures.** Readers adjust and play the demos, in the post and on the slides.
- **Built to write with an agent.** Everything is plain text, one folder per post. `AGENTS.md` and the build's checks
  tell an AI agent how to draft, build figures and check its own work.
- **Works offline.** Each post downloads as one HTML file with working figures, and as a text version for AI readers.
- **Easy to host.** A static site, with a workflow that deploys it to GitHub Pages.

## Start

```sh
git clone https://github.com/bhoov/bloggie.git my-blog && cd my-blog
npm install
npm run dev        # http://localhost:4321/
```

The example post, "How this blog works", shows each feature, and its deck shows each kind of slide. To start your own
post, copy its folder, `src/pages/posts/how-this-blog-works/`, to `src/pages/posts/<slug>/`. Set your title, name and
site address in `src/site.js`. Use Node 22 or later; the deploy workflow uses 22.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/pages/posts/<slug>/` | One post: `index.mdx`, its deck `slides.mdx` (optional), its `data/` and `media/` |
| `src/figures/<figure>/` | One interactive figure: a Svelte component, its numerics, their tests and checks |
| `src/references.json`, `src/site.js` | Your citations, and your site's title, author and address |
| `bloggie/` | The engine: layouts, the slide kit and editor, downloads, checks and the test runner |
| `AGENTS.md`, `.claude/skills/` | The rules your agent follows, and the skill that makes a deck from a post |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Preview; each save is drawn in the open page, and `E` on a deck turns on the slide editor |
| `npm run build` | Check symbol colors, links and the engine's boundary, then build `dist/` and each post's downloads |
| `npm test` | The unit tests, then the end-to-end checks in headless Chromium |
| `npm run bloggie:pull` | Bring in a newer engine from a checkout of this repository (`-- --from ../bloggie`) |

## Contributing

Bloggie is developed inside a working blog and copied here. To change the engine, open a pull request against
`bloggie/` in this repository.

## License

Apache 2.0. See [LICENSE](LICENSE).
