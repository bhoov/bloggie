# Bloggie, the engine

This folder is Bloggie: the layouts, components, slide kit and editor, styles, checks and e2e runner that a blog builds
with. In a blog it is the `bloggie/` folder, kept as a git subtree of https://github.com/bhoov/bloggie; the blog's own
`AGENTS.md` covers posts and figures. `template/` is the starter blog that `scripts/create.js` copies (`npx`), and the
demo site (`.github/workflows/demo.yml`).

- An engine file imports only engine files, the blog's site data (`src/site.js`, `src/references.json`,
  `src/roles.js`) and npm packages, never a post or a figure; `scripts/check-kit.js` fails the build otherwise.
- Build every feature as a general one, with no post's names or data in it, and say in a comment what it is for.
- A change here reaches every blog that updates. Keep a blog's files (`src/`, its `astro.config.mjs`, `package.json`)
  working as they are: add before you remove, and say in the commit what a blog must change, if anything.
- The engine's dependencies are in this folder's `package.json`; a blog lists this folder as an npm workspace.
- Commit engine changes apart from a blog's changes. From a blog, `git subtree push --prefix=bloggie <remote> <branch>`
  sends them to a branch of the engine's repository, for a pull request.
- Check a change in a blog: `npm run build` and `npm run e2e` there. For the starter blog, make one with
  `node scripts/create.js <folder> --copy-engine` and run the same.
