// `npm run bloggie:update` (node bloggie/scripts/update.js) in a blog that keeps Bloggie as its bloggie/ folder (made
// with `npm create bloggie <folder> -- --git`): merge Bloggie's main into bloggie/. Only bloggie/ must be committed;
// work in progress elsewhere in the blog stays as it is (scripts/subtree.js). On a conflict it changes nothing and
// says how to merge by hand.
//
//   --repo <url>   Bloggie's repository (default https://github.com/bhoov/bloggie.git)
//   --ref <name>   its branch (default main)
//   -m "…"         the merge commit's message (default "Update Bloggie")
import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { mergeIntoFolder, SubtreeError } from './subtree.js'

const { values: opts } = parseArgs({ options: {
  repo: { type: 'string', default: 'https://github.com/bhoov/bloggie.git' },
  ref: { type: 'string', default: 'main' },
  m: { type: 'string', short: 'm', default: 'Update Bloggie' },
} })
const root = fileURLToPath(new URL('../..', import.meta.url))
const prefix = relative(root, fileURLToPath(new URL('..', import.meta.url))).replace(/\/$/, '') // bloggie

execFileSync('git', ['fetch', '--quiet', opts.repo, opts.ref], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
const upstream = execFileSync('git', ['rev-parse', 'FETCH_HEAD'], { cwd: root, encoding: 'utf8' }).trim()
try {
  const result = mergeIntoFolder({ root, prefix, commit: upstream, message: opts.m })
  if (!result.merged) console.log(`bloggie:update: ${prefix}/ already has Bloggie's ${opts.ref} (${upstream.slice(0, 7)})`)
  else console.log(`bloggie:update: merged Bloggie's ${opts.ref} (${upstream.slice(0, 7)}) into ${prefix}/ as ${result.commit.slice(0, 7)}\n${result.changed}`)
} catch (error) {
  if (!(error instanceof SubtreeError)) throw error
  console.error(`bloggie:update: ${error.message}`)
  process.exit(1)
}
