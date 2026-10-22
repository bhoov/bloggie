// Run after `astro build` (part of `npm run build`): writes the two downloads that the byline's download
// control links to, beside each built post in dist/posts/<slug>/:
//   <slug>.html        the interactive page, one file that opens from disk with working figures
//   <slug>-agent.html  a text export for language models (bloggie/scripts/export/agent.js)
// Under `npm run dev`, bloggie/scripts/export/dev.js builds them on request instead.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist } from './export/common.js'
import { downloadNames, exportPost } from './export/index.js'

const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`

// A blog with no visible post (e.g. after npm run reset, with the example hidden) has no dist/posts.
const built = existsSync(join(dist, 'posts')) ? readdirSync(join(dist, 'posts')) : []
for (const slug of built) {
  if (!existsSync(join(dist, 'posts', slug, 'index.html'))) continue
  const files = await exportPost({ out: dist, slug })
  const names = downloadNames(slug)
  for (const kind of ['page', 'agent']) writeFileSync(join(dist, 'posts', slug, names[kind]), files[kind])
  console.log(`export-posts: ${names.page} (${kb(files.page)}), ${names.agent} (${kb(files.agent)})`)
}
