#!/usr/bin/env node
// `npx github:bhoov/bloggie <folder>`: a new blog in <folder> (default my-blog). npm fetches Bloggie and runs this file
// from it; it copies Bloggie into the folder, dates the example post today, makes the folder a git repository and runs
// `npm install` there. The new blog gets a README of its own, its package is named after its title (or its folder),
// and only bloggie/LICENSE stays: the root LICENSE is Bloggie's, and the blog's posts are the author's.
// Options: --title "…", --author "…" and --url "https://…/" set the site's title, author and address in src/site.js (through bloggie/scripts/reset.js, which writes them); --no-install skips the install.
//
// npm leaves .gitignore out of what it fetches, so the copy gets the list below when it has none, and it may leave out
// the link .claude/skills/bloggie-slides (to .agents/skills/bloggie-slides, for Claude Code), which the copy gets again.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const GITIGNORE = `/node_modules/
/dist/
/.astro/
/bloggie/e2e/report/
/logs/
`
const README = (title) => `# ${title}

A blog made with [Bloggie](https://github.com/bhoov/bloggie): interactive posts, each with an optional slide deck.

## Write

\`\`\`sh
npm run dev      # http://localhost:4321/
\`\`\`

The page redraws each time you save a file.
The example post, \`src/pages/posts/how-this-blog-works/\`, shows every feature.
Copy its folder to start a post.
Set the title, author and address in \`src/site.js\`.

## Publish

Push to \`main\` on GitHub, and the workflow in \`.github/workflows/\` publishes the site to GitHub Pages.
Once, in the repository's Settings → Pages, set the source to GitHub Actions.

\`npm run build\` checks every link and citation and builds the site into \`dist/\`.
`
function isLink(path) { try { return lstatSync(path).isSymbolicLink() } catch { return false } }
const SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.github/readme']) // .github/readme: Bloggie's README pictures

const { values: opts, positionals } = parseArgs({ allowPositionals: true, options: {
  title: { type: 'string' },
  author: { type: 'string' },
  url: { type: 'string' },
  'no-install': { type: 'boolean', default: false },
} })
const from = fileURLToPath(new URL('../..', import.meta.url))
const to = resolve(positionals[0] ?? 'my-blog')
if (existsSync(to) && readdirSync(to).length) throw new Error(`bloggie: ${to} is not empty`)

cpSync(from, to, { recursive: true, verbatimSymlinks: true, filter: (path) => {
  const parts = relative(from, path).split(/[\\/]/)
  return !SKIP.has(parts[0]) && !SKIP.has(parts.slice(0, 2).join('/'))
} })
if (!existsSync(join(to, '.gitignore'))) writeFileSync(join(to, '.gitignore'), GITIGNORE)
const skillLink = join(to, '.claude/skills/bloggie-slides')
if (!existsSync(skillLink) && !isLink(skillLink)) {
  mkdirSync(join(to, '.claude/skills'), { recursive: true })
  symlinkSync('../../.agents/skills/bloggie-slides', skillLink)
}

// The example post is dated the day the blog starts; its `edited:` date goes with the old one.
const post = join(to, 'src/pages/posts/how-this-blog-works/index.mdx')
const today = new Date().toISOString().slice(0, 10)
writeFileSync(post, readFileSync(post, 'utf8').replace(/^date: .*$/m, `date: ${today}`).replace(/^edited: .*\n/m, ''))

// The blog's own README, package name and license.
const title = opts.title ?? basename(to)
const name = title.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'blog'
const pkgPath = join(to, 'package.json')
const { name: _, description: __, bin: ___, license: ____, version: _____, ...pkg } = JSON.parse(readFileSync(pkgPath, 'utf8'))
writeFileSync(pkgPath, JSON.stringify({ name, ...pkg }, null, 2) + '\n')
writeFileSync(join(to, 'README.md'), README(title))
rmSync(join(to, 'LICENSE'), { force: true })

const site = ['title', 'author', 'url'].filter((key) => opts[key]).flatMap((key) => [`--${key}`, opts[key]])
if (site.length) execFileSync(process.execPath, ['bloggie/scripts/reset.js', '--yes', ...site], { cwd: to, stdio: 'ignore' })
execFileSync('git', ['init', '-q'], { cwd: to })
if (!opts['no-install']) execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: to, stdio: 'inherit' })
console.log(`\nbloggie: a new blog in ${to}\n  cd ${relative(process.cwd(), to) || '.'} && npm run dev`)
