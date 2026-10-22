// Run after `astro build` (part of `npm run build`): every in-page link, href="#id", in dist/**/*.html
// must point to an element with that id on the same page. A renamed heading or figure id fails the build.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../../dist/', import.meta.url))

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(path)
    else if (path.endsWith('.html')) yield path
  }
}

let missing = 0
for await (const file of htmlFiles(dist)) {
  const page = await readFile(file, 'utf8')
  const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
  for (const [, id] of page.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(decodeURIComponent(id))) {
      console.error(`${relative(dist, file)}: link to #${id} has no target`)
      missing++
    }
  }
}
if (missing) process.exit(1)
console.log('check-links: every in-page link has a target')
