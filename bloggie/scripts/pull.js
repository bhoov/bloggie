// `npm run bloggie:pull`: bring a newer Bloggie into this blog from a checkout of its repository (AGENTS.md, "Bloggie").
// Option: --from <checkout> (default: ../bloggie beside this repository, or $BLOGGIE_REPO).
//
// It replaces bloggie/ with the checkout's. The other files that Bloggie needs (bloggie.json lists them: package.json,
// astro.config.mjs, …) hold this blog's own settings too, so it does not change them: it prints how they differ, to merge
// by hand. Review the change with `git diff`, build, and commit it as any other edit. It refuses to run while bloggie/
// has uncommitted changes, so that nothing of yours is overwritten.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { values: opts } = parseArgs({ options: { from: { type: 'string' } } })
const from = resolve(opts.from ?? process.env.BLOGGIE_REPO ?? join(root, '..', 'bloggie'))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

if (!existsSync(join(from, 'bloggie'))) throw new Error(`bloggie:pull: ${from} has no bloggie/ folder (pass --from <checkout>)`)
if (git('status', '--porcelain', '--', 'bloggie').trim()) throw new Error('bloggie:pull: bloggie/ has uncommitted changes; commit them first')

rmSync(join(root, 'bloggie'), { recursive: true, force: true })
cpSync(join(from, 'bloggie'), join(root, 'bloggie'), { recursive: true })
console.log(git('status', '--short', '--', 'bloggie').trim() || 'bloggie:pull: bloggie/ is unchanged')

// The root files: shown, not changed. A folder (.claude/skills/…) is compared file by file by git.
const { kit } = JSON.parse(readFileSync(join(root, 'bloggie.json'), 'utf8'))
for (const path of kit.filter((p) => p !== 'bloggie' && !p.startsWith('bloggie/'))) {
  const ours = join(root, path)
  const theirs = join(from, path)
  if (!existsSync(theirs)) continue
  try {
    execFileSync('git', ['diff', '--no-index', '--stat', '--', ours, theirs], { encoding: 'utf8' })
  } catch (error) {
    console.log(`\n${path} differs from Bloggie's (merge by hand if you want its change):\n${error.stdout}`)
  }
}
