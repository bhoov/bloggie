// Reset the blog to a clean template for new content: `npm run reset` prints what it would do,
// `npm run reset -- --yes` does it. Options: --title "…" --author "…" --url "https://…/".
//
// It keeps nothing custom. It keeps the example post (src/pages/posts/how-this-blog-works/) and deletes
// every other post, every figure the kept post does not use (followed through the figures' own imports;
// a figure's e2e check is in its folder, so it goes too), every file in src/figures/shared/ and every
// slide picture in src/components/slides/ that nothing kept uses, and the references it does not cite.
// It sets the site's title, author and URL in src/site.js, and deletes uv.lock (the deleted posts' Python). A blog that
// keeps a starting version of a file of its own (RESET_FILES: AGENTS_reset.md, only the rules every new blog needs, and
// src/roles_reset.js, neutral symbol roles) has it moved over that file; a blog made by reset has none of them. Bloggie, the engine (every path in bloggie.json: bloggie/lib, bloggie/layouts,
// bloggie/editor, bloggie/live, the slide kit, styles, the tests' runner, the deploy workflow), stays whole. To take the example post off the site,
// rename its folder to _how-this-blog-works (Astro skips page folders that start with "_") or delete it.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'

const KEEP = ['how-this-blog-works']
const RESET_FILES = { 'AGENTS_reset.md': 'AGENTS.md', 'src/roles_reset.js': 'src/roles.js' } // a starting version: the file it replaces
const root = new URL('../..', import.meta.url).pathname
const posts = join(root, 'src/pages/posts')
const figures = join(root, 'src/figures')
const shared = join(figures, 'shared')
const slideComponents = join(root, 'src/components/slides')

const { values: opts } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    title: { type: 'string', default: 'My blog' },
    author: { type: 'string', default: 'Your Name' },
    url: { type: 'string', default: 'https://example.github.io/my-blog/' },
  },
})

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})
const read = (path) => readFileSync(path, 'utf8')

// Figures the kept posts use: `@/figures/<name>/` in a post, then `../<name>/` inside a figure. A figure
// is its whole folder; src/figures/shared/ holds single files, so only the files imported from it stay.
const used = new Set()
const usedShared = new Set()
const queue = KEEP.flatMap((post) => files(join(posts, post))).filter((f) => f.endsWith('.mdx'))
for (let i = 0; i < queue.length; i++) {
  const inShared = queue[i].startsWith(shared + '/')
  for (const [, name, file] of read(queue[i]).matchAll(/(?:@\/figures|\.\.)\/([\w-]+)\/([\w.-]+)/g)) {
    if (name === 'shared') {
      if (!usedShared.has(file) && existsSync(join(shared, file))) { usedShared.add(file); queue.push(join(shared, file)) }
      continue
    }
    if (used.has(name) || !existsSync(join(figures, name))) continue
    used.add(name)
    queue.push(...files(join(figures, name)).filter((f) => /\.(js|svelte)$/.test(f)))
  }
  // a shared file's own imports of its neighbours: './Other.svelte'
  if (inShared) for (const [, file] of read(queue[i]).matchAll(/from '\.\/([\w.-]+)'/g)) {
    if (!usedShared.has(file) && existsSync(join(shared, file))) { usedShared.add(file); queue.push(join(shared, file)) }
  }
}
if (usedShared.size) used.add('shared')

// Slide pictures the kept files use (a tag or an import in a kept post, or the slide engine's own Slide and Notes).
const keptText = [...queue, ...files(join(root, 'bloggie/lib')), ...files(join(root, 'bloggie/layouts'))].map(read).join('\n')
const dropSlideComponents = readdirSync(slideComponents).filter((name) => {
  const component = name.replace(/\.astro$/, '')
  return !new RegExp(`<${component}\\b|/${component}\\.astro`).test(keptText)
})

// References the kept posts cite, <Cite key="a,b">, and those that Bloggie's own files cite (its e2e checks write posts
// that cite them).
const cited = new Set([...KEEP.flatMap((post) => files(join(posts, post))), ...files(join(root, 'bloggie'))].filter((f) => /\.(mdx|js)$/.test(f))
  .flatMap((f) => [...read(f).matchAll(/<Cite\s+key="([^"]+)"/g)].flatMap(([, keys]) => keys.split(',').map((k) => k.trim()))))
const referencesPath = join(root, 'src/references.json')
const references = JSON.parse(read(referencesPath))

// Bloggie's own files stay even when the example does not use them (a figure folder that holds one stays, less its other files).
const bloggie = JSON.parse(read(join(root, 'bloggie.json'))).kit.map((path) => join(root, path))
const inBloggie = (path) => bloggie.some((d) => path === d || path.startsWith(d + '/'))
const holdsBloggie = (dir) => bloggie.some((d) => d.startsWith(dir + '/'))
const dropSlides = dropSlideComponents.filter((name) => !inBloggie(join(slideComponents, name)))
const dropPosts = readdirSync(posts).filter((name) => !KEEP.includes(name) && statSync(join(posts, name)).isDirectory())
const dropFigures = readdirSync(figures).filter((name) => !used.has(name) && !holdsBloggie(join(figures, name)) && statSync(join(figures, name)).isDirectory())
const dropShared = used.has('shared') || holdsBloggie(shared) ? readdirSync(shared).filter((name) => !usedShared.has(name) && !inBloggie(join(shared, name))) : []
const dropReferences = Object.keys(references).filter((key) => !cited.has(key))

const rel = (path) => relative(root, path)
console.log(`${opts.yes ? 'Resetting' : 'Would reset (dry run; add --yes to apply)'}:`)
console.log(`  keep the example post: ${KEEP.map((p) => rel(join(posts, p))).join(', ')}`)
console.log(`  delete ${dropPosts.length} post(s): ${dropPosts.join(', ') || 'none'}`)
console.log(`  keep figure(s) the example uses: ${[...used].join(', ') || 'none'}`)
console.log(`  delete ${dropFigures.length} figure(s): ${dropFigures.join(', ') || 'none'}`)
console.log(`  delete ${dropShared.length} unused file(s) in src/figures/shared: ${dropShared.join(', ') || 'none'}`)
console.log(`  delete ${dropSlides.length} unused slide picture(s) in src/components/slides: ${dropSlides.join(', ') || 'none'}`)
console.log(`  keep ${cited.size} reference(s), delete ${dropReferences.length}`)
console.log(`  site: title "${opts.title}", author "${opts.author}", url ${opts.url}`)
const resetFiles = Object.entries(RESET_FILES).filter(([from]) => existsSync(join(root, from)))
for (const [from, to] of resetFiles) console.log(`  ${to}: replace with ${from}`)
const lockPath = join(root, 'uv.lock')
if (existsSync(lockPath)) console.log("  uv.lock: delete (it lists the deleted posts' Python; `uv sync` writes a new one)")
if (!opts.yes) process.exit(0)

for (const name of dropPosts) rmSync(join(posts, name), { recursive: true })
for (const name of dropFigures) rmSync(join(figures, name), { recursive: true })
for (const name of dropShared) rmSync(join(shared, name))
for (const name of dropSlides) rmSync(join(slideComponents, name))
for (const key of dropReferences) delete references[key]
writeFileSync(referencesPath, JSON.stringify(references, null, 2) + '\n')

const sitePath = join(root, 'src/site.js')
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
let site = read(sitePath)
for (const [key, value] of Object.entries({
  title: opts.title,
  author: opts.author,
  url: opts.url,
  description: `Interactive essays by ${opts.author}.`,
  lede: 'Interactive essays with live figures, and a talk deck for each.',
})) site = site.replace(new RegExp(`^(\\s*${key}: )'(?:[^'\\\\]|\\\\.)*'`, 'm'), `$1${quote(value)}`)
// The comment above `url` describes this blog's own hosting; a new blog gets the general one.
site = site.replace(/^(\s*)\/\/ The deployed site\.[^\n]*(?:\n\s*\/\/[^\n]*)*(?=\n\s*url: )/m, "$1// The deployed site. A downloaded copy of a post links back here (bloggie/scripts/export/common.js), and a heading's\n$1// # copies a link here.")
writeFileSync(sitePath, site)
for (const [from, to] of resetFiles) renameSync(join(root, from), join(root, to))
if (existsSync(lockPath)) rmSync(lockPath)

console.log(`Done. Next: npm run dev, then copy src/pages/posts/${KEEP[0]}/ to start a post.`)
