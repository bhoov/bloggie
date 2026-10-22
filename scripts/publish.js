// `npm run bloggie:push -- -m "…"` (node bloggie/scripts/publish.js): publish this blog's bloggie/ folder to Bloggie's
// repository as one new commit, with the message given here. Only the folder's content goes: none of the blog's
// commits, messages or other files. Without --yes it shows what would change and stops.
//
//   -m "…"           the commit message (required); it is public
//   --yes            publish; without it, only show the change
//   --branch <name>  push to this branch, for a pull request (default: bloggie/<date>-<time>)
//   --main           push to main instead
//   --remote <url>   Bloggie's repository (default git@github.com:bhoov/bloggie.git; a fork, to contribute)
//
// It never overwrites Bloggie: it refuses unless the blog has already merged Bloggie's main (`npm run bloggie:update`),
// so the new commit holds every change made there. After a push to main it records the new commit in the blog with
// `git subtree merge`, so the next `bloggie:update` and the next publish start from it.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { values: opts } = parseArgs({ options: {
  m: { type: 'string', short: 'm' },
  yes: { type: 'boolean', default: false },
  branch: { type: 'string' },
  main: { type: 'boolean', default: false },
  remote: { type: 'string', default: 'git@github.com:bhoov/bloggie.git' },
} })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const stop = (message) => { console.error(`bloggie:push: ${message}`); process.exit(1) }

if (!opts.m?.trim()) stop('give the public commit message: npm run bloggie:push -- -m "What changed in the engine"')
if (git('status', '--porcelain', '--', 'bloggie')) stop('bloggie/ has uncommitted changes; commit them first (only committed content is published)')

git('fetch', '--quiet', opts.remote, 'main')
const upstream = git('rev-parse', 'FETCH_HEAD')
try {
  git('merge-base', '--is-ancestor', upstream, 'HEAD')
} catch {
  stop(`Bloggie's main (${upstream.slice(0, 7)}) has changes this blog has not merged; run npm run bloggie:update first`)
}
const tree = git('rev-parse', 'HEAD:bloggie')
if (tree === git('rev-parse', `${upstream}^{tree}`)) {
  console.log(`bloggie:push: bloggie/ is the same as Bloggie's main (${upstream.slice(0, 7)}); nothing to publish`)
  process.exit(0)
}

const target = opts.main ? 'main' : opts.branch ?? `bloggie/${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
console.log(`bloggie:push: on top of Bloggie's main (${upstream.slice(0, 7)}), to ${opts.remote} ${target}:\n`)
console.log(git('diff', '--stat', upstream, tree))
console.log(`\nmessage: ${opts.m}\nauthor:  ${git('var', 'GIT_AUTHOR_IDENT').replace(/\s+\d+ [+-]\d{4}$/, '')}`)
if (!opts.yes) {
  console.log('\nbloggie:push: nothing sent; run again with --yes to publish')
  process.exit(0)
}

const commit = git('commit-tree', tree, '-p', upstream, '-m', opts.m)
git('push', '--quiet', opts.remote, `${commit}:refs/heads/${target}`)
console.log(`\nbloggie:push: published ${commit.slice(0, 7)} to ${target}`)
if (opts.main) {
  execFileSync('git', ['subtree', 'merge', '--prefix=bloggie', commit, '-m', `Record Bloggie ${commit.slice(0, 7)}, published from bloggie/`], { cwd: root, stdio: 'ignore' })
  console.log('bloggie:push: recorded it in this blog (git subtree merge)')
} else {
  console.log(`bloggie:push: open a pull request from ${target}; once it is merged, run npm run bloggie:update`)
}
