// Merge a commit of Bloggie into a blog's bloggie/ folder, as `git subtree merge` does, but touching only bloggie/:
// work in progress elsewhere in the blog, staged or not, stays as it is. `git subtree` and `git merge` refuse to run
// while anything in the repository is changed, and a merge commit made from the shared index would take in whatever
// another session had staged. Used by scripts/update.js (`npm run bloggie:update`) and scripts/publish.js (--main).
//
// The merge is of three trees: the Bloggie commit that the blog last merged (the merge base), the blog's bloggie/,
// and the new commit. Git merges them in memory (`git merge-tree`, git 2.40 or later), the new commit's tree is built
// in a separate index, HEAD moves to it only if no one has committed in the meantime, and then bloggie/ alone is
// checked out from it. The history is the same as `git subtree merge` gives: a merge commit whose second parent is
// the Bloggie commit. It refuses while bloggie/ has changes, and stops, changing nothing, on a conflict.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export class SubtreeError extends Error {}

export function mergeIntoFolder({ root, prefix, commit, message }) {
  const git = (args, env = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim()
  const ok = (args) => { try { git(args); return true } catch { return false } }

  if (git(['status', '--porcelain', '--', prefix])) throw new SubtreeError(`${prefix}/ has uncommitted or untracked changes; commit them first`)
  const head = git(['rev-parse', 'HEAD'])
  if (!ok(['rev-parse', '--verify', '--quiet', `${head}:${prefix}`])) throw new SubtreeError(`this blog has no ${prefix}/ folder in its last commit`)
  if (ok(['merge-base', '--is-ancestor', commit, head])) return { merged: false }

  let base
  try { base = git(['merge-base', head, commit]) } catch { throw new SubtreeError(`${prefix}/ shares no history with ${commit.slice(0, 7)}; merge it with git subtree merge`) }

  // The blog's bloggie/ as a commit on top of the merge base, so that git merges the folder as Bloggie's root.
  const ours = git(['commit-tree', `${head}:${prefix}`, '-p', base, '-m', `${prefix}/ of ${head}`])
  let merged
  try {
    merged = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${base}`, ours, commit]).split('\n')[0]
  } catch (error) {
    const files = String(error.stdout ?? '').split('\n').slice(1).filter(Boolean).map((f) => `${prefix}/${f}`)
    throw new SubtreeError(`the merge conflicts in ${files.join(', ') || prefix + '/'}; nothing changed. With nothing else uncommitted, run git subtree merge --prefix=${prefix} ${commit} and resolve it as any merge conflict`)
  }

  // The new commit: HEAD's tree with bloggie/ replaced, built in an index of its own.
  const scratch = mkdtempSync(join(tmpdir(), 'bloggie-merge-'))
  const index = { GIT_INDEX_FILE: join(scratch, 'index') }
  let tree
  try {
    git(['read-tree', head], index)
    git(['rm', '-r', '--cached', '--quiet', '--', prefix], index)
    git(['read-tree', `--prefix=${prefix}/`, merged], index)
    tree = git(['write-tree'], index)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const result = git(['commit-tree', tree, '-p', head, '-p', commit, '-m', message])
  try {
    git(['update-ref', '-m', message, 'HEAD', result, head]) // only if HEAD is still `head`
  } catch {
    throw new SubtreeError('a commit was made while merging; nothing changed, run it again')
  }
  git(['restore', '--source=HEAD', '--staged', '--worktree', '--', prefix])
  return { merged: true, commit: result, changed: git(['diff', '--stat', head, result, '--', prefix]) }
}
