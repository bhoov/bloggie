// Run by `npm run build`: the boundary of Bloggie, the blog's reusable engine (AGENTS.md, "Bloggie"). bloggie.json
// lists the files and folders that are Bloggie (`kit`) and the site data that Bloggie may read (`site`). A kit file may
// import other kit files, the site files and npm packages, never a post, a post's figure or a slide picture. This prints
// every import that leaves the kit, and every kit path that does not exist, and exits 1.
//
// An import whose file does not exist is not checked: it is text that a script writes into a copy (bloggie/e2e/live.js writes
// a post that imports a figure it creates), or a missing file, which the build itself reports.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { kit, site, exclude } = JSON.parse(readFileSync(join(root, 'bloggie.json'), 'utf8'))
const inside = (path, list) => list.some((p) => path === join(root, p) || path.startsWith(join(root, p) + '/'))

const problems = []
const files = (path) => {
  if (inside(path, exclude)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => files(join(path, name)))
}
const kitFiles = kit.flatMap((p) => {
  if (existsSync(join(root, p))) return files(join(root, p))
  problems.push(`bloggie.json: ${p} does not exist`)
  return []
}).filter((f) => /\.(m?js|astro|svelte|css)$/.test(f))

// `from '…'`, a side-effect `import '…'`, a dynamic `import('…')` and a CSS `@import '…'` or `@import url(…)`.
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\()?)['"]([^'"\n]+)['"]/g
const EXTENSIONS = ['', '.js', '.mjs', '.svelte', '.astro', '/index.js']
const target = (file, spec) => {
  const path = spec.split('?')[0]
  if (path.startsWith('@/')) return join(root, 'src', path.slice(2))
  if (path.startsWith('.')) return resolve(dirname(file), path)
  return null // an npm package, astro:…, or a virtual module
}

for (const file of kitFiles) {
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const base = target(file, spec)
    const found = base && EXTENSIONS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile())
    if (found && !inside(found, kit) && !inside(found, site)) {
      problems.push(`${relative(root, file)}: imports ${relative(root, found)}, which is outside Bloggie (bloggie.json)`)
    }
  }
}

for (const problem of problems) console.error(`check-kit: ${problem}`)
if (problems.length) process.exit(1)
console.log(`check-kit: ${kitFiles.length} Bloggie files import only Bloggie, the site's data and npm packages`)
