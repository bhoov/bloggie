#!/usr/bin/env node
// `npx --allow-git=root github:bhoov/bloggie <folder>`: a new blog in <folder> (default my-blog). npm fetches Bloggie and
// runs this file from it. The blog is the starter in template/: the example post, src/site.js, AGENTS.md, the deploy
// workflow. This dates the example post today, names the blog, makes the folder a git repository with one commit, and
// adds the engine as bloggie/ with `git subtree add`, so that `npm run bloggie:update` takes later versions of it. Then
// it runs `npm install`.
//
// Options: --title "…" and --author "…" set the site's title and author in src/site.js, and --url "https://…/" its
// address, for a host other than GitHub Pages. --engine <repository> and --ref <branch> name the engine to add (default
// https://github.com/bhoov/bloggie.git, main). --copy-engine copies this engine into bloggie/ instead, with no git (the
// demo build). --no-install skips the install.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values: opts, positionals } = parseArgs({ allowPositionals: true, options: {
  title: { type: 'string' },
  author: { type: 'string' },
  url: { type: 'string' },
  engine: { type: 'string', default: 'https://github.com/bhoov/bloggie.git' },
  ref: { type: 'string', default: 'main' },
  'copy-engine': { type: 'boolean', default: false },
  'no-install': { type: 'boolean', default: false },
} })
const engine = fileURLToPath(new URL('..', import.meta.url))
const to = resolve(positionals[0] ?? 'my-blog')
if (existsSync(to) && readdirSync(to).length) throw new Error(`bloggie: ${to} is not empty`)
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: to, stdio: 'ignore', ...options })

// The starter blog. npm leaves out every .gitignore of a package, so the template's is named gitignore.
cpSync(join(engine, 'template'), to, { recursive: true })
renameSync(join(to, 'gitignore'), join(to, '.gitignore'))

// The example post is dated the day the blog starts; its `edited:` date goes with the old one.
const post = join(to, 'src/pages/posts/how-this-blog-works/index.mdx')
const today = new Date().toISOString().slice(0, 10)
writeFileSync(post, readFileSync(post, 'utf8').replace(/^date: .*$/m, `date: ${today}`).replace(/^edited: .*\n/m, ''))

// The site's title, author and address (src/site.js), the package's name and the README's title.
const title = opts.title ?? basename(to)
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
let site = readFileSync(join(to, 'src/site.js'), 'utf8')
const set = (key, value) => { site = site.replace(new RegExp(`^(\\s*${key}: )'(?:[^'\\\\]|\\\\.)*'`, 'm'), `$1${quote(value)}`) }
if (opts.title) set('title', opts.title)
if (opts.author) { set('author', opts.author); set('description', `Interactive essays by ${opts.author}.`) }
if (opts.url) set('url', opts.url)
writeFileSync(join(to, 'src/site.js'), site)
const pkgPath = join(to, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.name = title.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'blog'
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
const readme = join(to, 'README.md')
writeFileSync(readme, readFileSync(readme, 'utf8').replace(/^# .*$/m, `# ${title}`))

// The slides skill is the engine's (bloggie/skills/); agents find it through these links: .agents/skills for any
// agent, .claude/skills for Claude Code.
for (const dir of ['.agents/skills', '.claude/skills']) {
  mkdirSync(join(to, dir), { recursive: true })
  symlinkSync('../../bloggie/skills/bloggie-slides', join(to, dir, 'bloggie-slides'))
}

if (opts['copy-engine']) {
  const skip = new Set(['template', '.git', '.github', 'node_modules'])
  cpSync(engine, join(to, 'bloggie'), { recursive: true, filter: (path) => !skip.has(relative(engine, path).split(/[\\/]/)[0]) })
} else {
  run('git', ['init', '-q', '-b', 'main'])
  run('git', ['add', '-A'])
  run('git', ['commit', '-q', '-m', 'Start a blog with Bloggie'])
  run('git', ['subtree', 'add', '--prefix=bloggie', opts.engine, opts.ref, '-m', 'Add Bloggie, the engine, as bloggie/'], { stdio: 'inherit' })
}
if (!opts['no-install']) run('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit' })
const near = relative(process.cwd(), to) // the folder as typed, unless that path climbs out of here
console.log(`\nbloggie: a new blog in ${to}\n  cd ${near.startsWith('..') ? to : near || '.'} && npm run dev`)
