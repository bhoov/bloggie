// `npm run bloggie:push`: write Bloggie, as a new blog gets it, into a checkout of its public repository, and commit it
// there (AGENTS.md, "Bloggie"). Options: --to <checkout> (default: ../bloggie beside this repository, or $BLOGGIE_REPO);
// --push also pushes that commit.
//
// It takes this repository's committed HEAD (`git archive`: no uncommitted file and no history), runs `reset` in that
// copy, and then makes the copy a template: the package is named bloggie, dependencies that no file imports are dropped
// (the lock is written again), bloggie/README.md and bloggie/LICENSE go to the root, and files that only this blog needs
// are removed. The checkout's files (all but .git) are replaced by the result, so each push is one snapshot commit.
import { execFileSync, execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { values: opts } = parseArgs({ options: { to: { type: 'string' }, push: { type: 'boolean', default: false } } })
const to = resolve(opts.to ?? process.env.BLOGGIE_REPO ?? join(root, '..', 'bloggie'))
const DROP = ['.hugo_build.lock'] // tracked here, needed only by this blog
const KEEP_DEPENDENCIES = new Set(['d3']) // imported by no file of the template, but recommended for figures (AGENTS.md)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

if (!existsSync(join(to, '.git'))) throw new Error(`bloggie:push: ${to} is not a git checkout (clone the Bloggie repository there, or pass --to)`)
if (git(to, 'status', '--porcelain')) throw new Error(`bloggie:push: ${to} has uncommitted changes`)
const head = git(root, 'rev-parse', '--short', 'HEAD')

const copy = mkdtempSync(join(tmpdir(), 'bloggie-push-'))
execSync(`git archive HEAD | tar -x -C ${JSON.stringify(copy)}`, { cwd: root })
execFileSync(process.execPath, ['bloggie/scripts/reset.js', '--yes'], { cwd: copy, stdio: 'ignore' })
for (const file of DROP) rmSync(join(copy, file), { force: true })
cpSync(join(copy, 'bloggie/README.md'), join(copy, 'README.md'))
cpSync(join(copy, 'bloggie/LICENSE'), join(copy, 'LICENSE'))

// The package: its name, license and description, and only the dependencies that a file of the template imports.
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return name === 'node_modules' ? [] : statSync(path).isDirectory() ? files(path) : [path]
})
const source = files(copy).filter((f) => /\.(m?js|svelte|astro|mdx)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')
const imported = (name) => new RegExp(`['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(/[^'"]*)?['"]`).test(source)
const pkgPath = join(copy, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const dropped = []
for (const field of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (!imported(name) && !KEEP_DEPENDENCIES.has(name)) { delete pkg[field][name]; dropped.push(name) }
  }
}
const { name: _, ...rest } = pkg
const template = { name: 'bloggie', description: 'Write one story with your AI agent. Publish it as an interactive blog post, and as a talk when you need one.', license: 'Apache-2.0', ...rest }
writeFileSync(pkgPath, JSON.stringify(template, null, 2) + '\n')
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: copy, stdio: 'ignore' })

// Replace the checkout's files with the copy's, and commit.
for (const name of readdirSync(to)) if (name !== '.git') rmSync(join(to, name), { recursive: true, force: true })
cpSync(copy, to, { recursive: true })
rmSync(copy, { recursive: true, force: true })
git(to, 'add', '-A')
if (!git(to, 'status', '--porcelain')) {
  console.log(`bloggie:push: ${to} already holds Bloggie from ${head}`)
} else {
  git(to, 'commit', '-q', '-m', `Bloggie from ${head}`)
  console.log(`bloggie:push: committed Bloggie from ${head} in ${to}${dropped.length ? `; dropped unused dependencies: ${dropped.join(', ')}` : ''}`)
  console.log(git(to, 'show', '--stat', '--format=%h %s', 'HEAD').split('\n').slice(-1)[0])
  if (opts.push) {
    git(to, 'push', '-u', 'origin', 'HEAD')
    console.log('bloggie:push: pushed')
  } else console.log(`bloggie:push: review it (git -C ${to} show --stat), then push it (git -C ${to} push), or run again with --push`)
}
