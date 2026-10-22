// remark plugin, slides.mdx only: <PostTable id="tbl-…" /> in a deck is the post's own element with that id, taken
// from index.mdx beside it at build time, so a table the post builds shows on its slide as the same table, never a
// summary of it. On the slide, a reference [](#eq-id) becomes plain "Eq. (n)" text, other in-page links lose their
// link, a figure control (an <a data-select>) and the caption are dropped, and an <Info> keeps only its term.
// build="<selector>": the elements it matches (e.g. tr:has(.baseline)) fade in together on the next step
// (bloggie/lib/slides.js). Under `npm run dev`, save slides.mdx again to see a change to the post's table.
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

const attr = (node, name) => node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)?.value

function walk(node, visit) {
  visit(node)
  node.children?.forEach((child) => walk(child, visit))
}

function strip(node) {
  delete node.position
  node.children?.forEach(strip)
}

// Rewrite the children of `node` for the slide.
function forSlide(node, numbers) {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'link' && child.url.startsWith('#')) {
      if (!child.children.length) {
        const id = child.url.slice(1)
        const n = numbers.get(id)
        return [{ type: 'text', value: n ? (id.startsWith('eq-') ? `Eq. (${n})` : `Fig. ${n}`) : id }]
      }
      forSlide(child, numbers)
      return child.children
    }
    if ((child.type === 'mdxJsxTextElement' || child.type === 'mdxJsxFlowElement') && child.name === 'a' && String(attr(child, 'href') ?? '').startsWith('#')) {
      if (attr(child, 'data-select') != null) return []
      forSlide(child, numbers)
      return child.children
    }
    if (child.name === 'figcaption') return []
    if (child.name === 'Info') {
      const term = attr(child, 'term')
      return term ? [{ type: 'text', value: term }] : []
    }
    forSlide(child, numbers)
    return [child]
  })
}

const posts = new Map()
function post(path) {
  const text = readFileSync(path, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, (m) => m.replace(/[^\n]/g, ''))
  if (posts.get(path)?.text === text) return posts.get(path)
  const tree = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkMath).parse(text)
  // The post's equation and figure numbers, in document order, as bloggie/lib/equations.js gives them.
  const numbers = new Map()
  let eq = 0, fig = 0
  walk(tree, (node) => {
    const label = node.type === 'math' && node.value.match(/\\label\{([A-Za-z0-9_-]+)\}/)
    if (label) numbers.set(label[1], ++eq)
    const id = attr(node, 'id')
    if (typeof id === 'string' && id.startsWith('fig-') && !numbers.has(id)) numbers.set(id, ++fig)
  })
  const entry = { text, tree, numbers }
  posts.set(path, entry)
  return entry
}

export default function remarkPostTables() {
  return (tree, file) => {
    if (!file.path || basename(file.path) !== 'slides.mdx') return
    walk(tree, (node) => {
      if (!node.children) return
      node.children = node.children.map((child) => {
        if (child.type !== 'mdxJsxFlowElement' || child.name !== 'PostTable') return child
        const id = attr(child, 'id')
        const source = post(join(dirname(file.path), 'index.mdx'))
        let found
        walk(source.tree, (n) => { if (!found && n.type === 'mdxJsxFlowElement' && attr(n, 'id') === id) found = n })
        if (!found) throw new Error(`${file.path}: <PostTable id="${id}" />: index.mdx has no element with that id`)
        const copy = structuredClone(found)
        strip(copy)
        forSlide(copy, source.numbers)
        copy.attributes = copy.attributes.filter((a) => a.name !== 'id')
        const build = attr(child, 'build')
        if (build) copy.attributes.push({ type: 'mdxJsxAttribute', name: 'data-steps', value: build })
        copy.position = child.position
        return copy
      })
    })
  }
}
