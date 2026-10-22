# Bloggie, the engine

This folder is Bloggie: the layouts, components, slide kit and editor, styles, checks and e2e runner that a blog builds
with. In a blog it is the npm package `bloggie` (`node_modules/bloggie/`), or, in a blog made with `--git`, the
`bloggie/` folder, kept as a git subtree of https://github.com/bhoov/bloggie; the blog's own `AGENTS.md` covers posts
and figures. `template/` is the starter blog that `scripts/create.js` copies (`npm create bloggie`), and the demo site
(`.github/workflows/demo.yml`). `create/` is the npm package `create-bloggie`, which runs `scripts/create.js`.

- An engine file imports only engine files, the blog's site data (`src/site.js`, `src/references.json`,
  `src/roles.js`) and npm packages, never a post or a figure; `scripts/check-kit.js` fails the build otherwise.
- The engine finds the blog by the folder it runs in (`lib/blog.js`), never by a relative path out of the engine:
  an Astro component imports the site data as `@/site.js`; code that Node runs imports it from `lib/blog.js`.
- Build every feature as a general one, with no post's names or data in it, and say in a comment what it is for.
- A change here reaches every blog that updates. Keep a blog's files (`src/`, its `astro.config.mjs`, `package.json`)
  working as they are: add before you remove, and say in the commit what a blog must change, if anything.
- The engine's dependencies are in this folder's `package.json`, under `dependencies`: npm does not install the
  `devDependencies` of a package that a blog depends on. A blog lists `bloggie` as a dependency, or, with `--git`, this
  folder as an npm workspace (npm links it as `node_modules/bloggie`, so a blog's scripts and imports work in both).
- A release goes to npm: raise `version` in `package.json` (and the template's `bloggie` dependency), then
  `npm publish` here. Publish `create/` (`create-bloggie`) only when its `index.js` changes.
- From a blog, `npm run bloggie:push -- -m "…" --yes` (`scripts/publish.js`) publishes `bloggie/` as one new commit on
  top of the engine's main and opens a pull request: to a branch of the engine's repository if you may push there,
  else of your fork (`gh` makes it; without `gh`, `--remote <fork>`). `--main` pushes to main. None of the blog's
  commits or messages go. Write that message for the public.
- Git: this repository's history is public and holds only engine commits. Commit here directly in a clone of it, or
  publish from a blog with `scripts/publish.js` (one commit per publish, its message written for the public). Never
  `git subtree push` a blog's history here, never force-push main, and keep main buildable: the demo deploys from it.
  A blog takes new commits with `npm run bloggie:update`.
- Check a change in a blog: `npm run build` and `npm run e2e` there. For the starter blog, make one with
  `node scripts/create.js <folder> --copy-engine` and run the same.
