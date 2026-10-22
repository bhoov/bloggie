# Bloggie

> Write one story with your AI agent. Publish it as an interactive blog post that ports to slides when you need them.

Bloggie turns one plain-text story into an interactive blog post. When you are ready, an AI agent makes a talk deck
from it that runs the same live figures. Every post downloads as a single HTML file that works offline.

- **One story, two forms.** A post, plus an optional slide deck beside it that reuses its figures and tables.
- **Built to write with an agent.** Everything is plain text, one folder per post. `AGENTS.md` and the build's checks
  tell an AI agent how to draft, build figures and check its own work.
- **You are in control.** The agent's slides may not be the slides you want. Edit them with the mouse in the dev
  server, and each change is written back to the deck's text file.
- **Interactive figures.** Everything is HTML, CSS and JavaScript. Readers play the demos in the post and on the slides.
- **Works offline.** Each post downloads as one HTML file with working figures, and as a text version for AI readers.
- **Easy to host.** A static site, with a workflow that deploys it to GitHub Pages.

## Start

```sh
npx github:bhoov/bloggie my-blog     # copies Bloggie into my-blog/, dates the example post today, installs
cd my-blog && npm run dev            # http://localhost:4321/
```

Or clone it: `git clone https://github.com/bhoov/bloggie.git my-blog && cd my-blog && npm install`.
Use Node 22 or later. Set your title, name and site address in `src/site.js`, and copy
`src/pages/posts/how-this-blog-works/` to `src/pages/posts/<slug>/` to start a post.

## Commands and keys

| Command | What it does |
| --- | --- |
| `npm run dev` | Preview at http://localhost:4321/ while you write |
| `npm run build` | Check symbol colors, links and citations, then build `dist/` and each post's downloads |
| `npm test` | The unit tests, then the end-to-end checks in headless Chromium |

Only under `npm run dev`: each save is drawn in the open page without a reload, E on a deck opens the slide editor,
and a download is built when you click it.

| Key | Where | What it does |
| --- | --- | --- |
| S | post | open its deck |
| T | post | fold or open the table of contents |
| → ← Space, Home End | deck | next and previous slide, first and last |
| F, N, P | deck | full screen, speaker notes, speaker view in a second window |
| Esc | deck | back to the post |
| E | deck, `npm run dev` | the slide editor; its keys follow Figma's (listed at the top of `bloggie/editor/client.js`) |

## How this blog works

This section is the example post, `src/pages/posts/how-this-blog-works/index.mdx`, converted to GitHub Markdown. Run
`npm run dev` to see it with its live figure and its deck.

<!-- how-this-blog-works -->

## Contributing

Bloggie is developed inside a working blog and copied here. To change the engine, open a pull request against
`bloggie/` in this repository.

## License

Apache 2.0. See [LICENSE](LICENSE).
