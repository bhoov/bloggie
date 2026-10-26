// Run after `astro build` (part of `npm run build`): writes the two downloads that the byline's download
// control links to, beside each built page under dist/posts/ that offers them (lib/pages.js: every post, and a
// subpage whose front matter sets `downloads: true`):
//   <name>.html        the interactive page, one file that opens from disk with working figures
//   <name>-agent.html  a text export for language models (bloggie/scripts/export/agent.js)
// <name> is the last part of the page's path: the post's slug, or the subpage's name.
// Each export inlines the page's scripts, styles, fonts and data into one file and bundles its figures, which takes
// time and space for every page; so a page without the control gets none.
// Under `npm run dev`, bloggie/scripts/export/dev.js builds them on request instead.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist } from './export/common.js'
import { downloadNames, exportPost } from './export/index.js'

const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`
// The byline's download control (layouts/Post.astro); a deck's page and a page that turns downloads off have none.
const OFFERS = /<[^>]*\sdata-download[\s>=]/

// The built pages under dist/posts/, by their paths there ('<slug>', '<slug>/<name>', ...).
function pages(dir, path = '') {
  const found = path && existsSync(join(dir, 'index.html')) ? [path] : []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...pages(join(dir, entry.name), path ? `${path}/${entry.name}` : entry.name))
  }
  return found
}

// A blog with no visible post (e.g. a new blog with the example hidden) has no dist/posts.
const built = existsSync(join(dist, 'posts')) ? pages(join(dist, 'posts')) : []
for (const path of built) {
  if (!OFFERS.test(readFileSync(join(dist, 'posts', path, 'index.html'), 'utf8'))) continue
  const files = await exportPost({ out: dist, path })
  const names = downloadNames(path)
  for (const kind of ['page', 'agent']) writeFileSync(join(dist, 'posts', path, names[kind]), files[kind])
  console.log(`export-posts: ${path}/${names.page} (${kb(files.page)}), ${names.agent} (${kb(files.agent)})`)
}
