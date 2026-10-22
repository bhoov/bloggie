// `npm run bloggie:push -- -m "…"` (node bloggie/scripts/publish.js): suggest a change to Bloggie from a blog. It
// publishes this blog's bloggie/ folder as one new commit on top of Bloggie's main, with the message given here, and
// opens a pull request. Only the folder's content goes: none of the blog's commits, messages or other files. Without
// --yes it shows what would change and stops.
//
//   -m "…"             the commit message and the pull request's title (required); it is public
//   --body "…"         the pull request's description: what the change does and why (default: the list of files)
//   --yes              publish; without it, only show the change
//   --branch <name>    the branch to push (default: bloggie/<date>-<time>)
//   --main             push to Bloggie's main instead, with no pull request (maintainers)
//   --remote <url>     where to push (default: Bloggie itself if you may push to it, else your fork, made if needed)
//   --upstream <url>   Bloggie's repository (default https://github.com/bhoov/bloggie.git)
//
// The commit's parent is Bloggie's own main, never a fork's, so a pull request from a fork that is behind holds only
// this change. It refuses unless the blog has already merged Bloggie's main (`npm run bloggie:update`), so the new
// commit holds every change made there. With the GitHub CLI (`gh`, logged in) it finds or makes your fork and opens the
// pull request; without it, pass --remote and open the pull request from the link it prints. After a push to main it
// records the new commit in the blog with `git subtree merge`, so the next `bloggie:update` and publish start from it.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { values: opts } = parseArgs({ options: {
  m: { type: 'string', short: 'm' },
  body: { type: 'string' },
  yes: { type: 'boolean', default: false },
  branch: { type: 'string' },
  main: { type: 'boolean', default: false },
  remote: { type: 'string' },
  upstream: { type: 'string', default: 'https://github.com/bhoov/bloggie.git' },
} })
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
const git = (...args) => run('git', args)
const gh = (...args) => { try { return run('gh', args) } catch { return null } }
const stop = (message) => { console.error(`bloggie:push: ${message}`); process.exit(1) }
const slugOf = (url) => /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1] ?? null // owner/name

if (!opts.m?.trim()) stop('give the public commit message: npm run bloggie:push -- -m "What changed in the engine"')
if (git('status', '--porcelain', '--', 'bloggie')) stop('bloggie/ has uncommitted changes; commit them first (only committed content is published)')

git('fetch', '--quiet', opts.upstream, 'main')
const upstream = git('rev-parse', 'FETCH_HEAD')
try {
  git('merge-base', '--is-ancestor', upstream, 'HEAD')
} catch {
  stop(`Bloggie's main (${upstream.slice(0, 7)}) has changes this blog has not merged; run npm run bloggie:update, commit, and publish again`)
}
const tree = git('rev-parse', 'HEAD:bloggie')
if (tree === git('rev-parse', `${upstream}^{tree}`)) {
  console.log(`bloggie:push: bloggie/ is the same as Bloggie's main (${upstream.slice(0, 7)}); nothing to publish`)
  process.exit(0)
}

// Where to push. With gh: Bloggie itself if you may push to it, else your fork of it (gh makes one, or finds yours).
// The URL uses gh's protocol (ssh or https), whose credentials gh has set up.
const upstreamSlug = slugOf(opts.upstream)
const hasGh = upstreamSlug && gh('auth', 'status') !== null
const githubUrl = (slug) => gh('config', 'get', 'git_protocol', '-h', 'github.com') === 'ssh' ? `git@github.com:${slug}.git` : `https://github.com/${slug}.git`
let remote = opts.remote
let forked = false
if (!remote && hasGh) {
  if (gh('api', `repos/${upstreamSlug}`, '--jq', '.permissions.push') === 'true') remote = githubUrl(upstreamSlug)
  else if (!opts.main) {
    const fork = opts.yes ? gh('api', '-X', 'POST', `repos/${upstreamSlug}/forks`, '--jq', '.full_name') : `${gh('api', 'user', '--jq', '.login')}/<your fork>`
    if (!fork) stop(`could not find or make your fork of ${upstreamSlug} with gh; make one on GitHub and pass --remote <its URL>`)
    remote = opts.yes ? githubUrl(fork) : fork
    forked = true
  }
}
if (!remote && opts.main) remote = upstreamSlug ? `git@github.com:${upstreamSlug}.git` : opts.upstream
if (!remote) stop(`no place to push: log in to the GitHub CLI (gh auth login, https://cli.github.com), or fork ${upstreamSlug ?? opts.upstream} and pass --remote <your fork's URL>`)

const target = opts.main ? 'main' : opts.branch ?? `bloggie/${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
const stat = git('diff', '--stat', upstream, tree)
console.log(`bloggie:push: on top of Bloggie's main (${upstream.slice(0, 7)}), to ${remote} ${target}${forked ? ' (your fork)' : ''}:\n`)
console.log(stat)
console.log(`\nmessage: ${opts.m}\nauthor:  ${git('var', 'GIT_AUTHOR_IDENT').replace(/\s+\d+ [+-]\d{4}$/, '')}`)
if (!opts.yes) {
  console.log('\nbloggie:push: nothing sent; run again with --yes to publish')
  process.exit(0)
}

const commit = git('commit-tree', tree, '-p', upstream, '-m', opts.m)
// A fork that GitHub has just made can take a few seconds to accept a push.
for (let attempt = 1; ; attempt++) {
  try { git('push', '--quiet', remote, `${commit}:refs/heads/${target}`); break } catch (error) {
    if (!forked || attempt === 5) stop(`the push to ${remote} failed:\n${error.stderr ?? error.message}`)
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt))
  }
}
console.log(`\nbloggie:push: published ${commit.slice(0, 7)} to ${target}`)
if (opts.main) {
  git('subtree', 'merge', '--prefix=bloggie', commit, '-m', `Record Bloggie ${commit.slice(0, 7)}, published from bloggie/`)
  console.log('bloggie:push: recorded it in this blog (git subtree merge)')
  process.exit(0)
}

// The pull request: gh opens it; without gh, GitHub's compare page does, from the link.
const head = `${slugOf(remote)?.split('/')[0] ?? '<owner>'}:${target}`
const body = opts.body ?? `Published from a blog's \`bloggie/\` folder with \`bloggie/scripts/publish.js\`.\n\n\`\`\`\n${stat}\n\`\`\``
const pr = hasGh && gh('pr', 'create', '--repo', upstreamSlug, '--base', 'main', '--head', head, '--title', opts.m, '--body', body)
if (pr) console.log(`bloggie:push: opened the pull request ${pr}`)
else if (upstreamSlug) console.log(`bloggie:push: open the pull request at https://github.com/${upstreamSlug}/compare/main...${head}?expand=1`)
console.log('bloggie:push: once it is merged, run npm run bloggie:update')
