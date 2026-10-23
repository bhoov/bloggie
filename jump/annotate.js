// Jump to source, the Markdown half (a rehype plugin; integration.js turns it on under `npm run dev` only). Each element
// that a page's MDX writes carries where it starts in that file, so that a Cmd+Shift+click on it can open the file
// there (client.js):
//
//   data-src="12:1-14:20"              the element's line and column, and where it ends
//   data-src-text="12:4 - 13:1"        the line and column of each of its text nodes, in order ("-": a text the file
//                                      does not hold, such as the line break between two list items)
//   data-src-file="src/pages/…/index.mdx" and data-src-version="<hash>", on each element with no such parent: the
//                                      file, relative to the blog, and which save of it these positions are from
//
// A page can show positions from an older save: the live update (bloggie/live/client.js) and the slide editor
// (bloggie/editor/patch.js) keep a block that a save did not change. The plugin keeps the text of each save (`saved`),
// and integration.js moves a position from the save it names to the same text in the file as it is now.
//
// A figure tag (a component) carries nothing: its props would change with every line above it, and the live update
// would draw the figure again. Svelte marks a figure's own elements in development (client.js reads them).
import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import { root } from '../lib/blog.js'

let on = false
export const setSourcePositions = (value) => { on = value }

// The text of each save the dev server has rendered, by version, oldest first.
const KEEP = 200
export const saved = new Map()
const versionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

const at = (node) => `${node.position.start.line}:${node.position.start.column}`
// An HTML element written in MDX, `<div>`, is JSX with a lowercase name; a component's name starts with a capital.
const isJsx = (node) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement'
const isTag = (node) => node.type === 'element' || (isJsx(node) && /^[a-z][\w-]*$/.test(node.name ?? ''))

function setAttribute(node, name, value) {
  if (node.type === 'element') node.properties[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
  else node.attributes.push({ type: 'mdxJsxAttribute', name, value })
}

// The start of each text node the browser will make from `node`'s children: adjacent texts become one node.
function textStarts(node) {
  const starts = []
  let text = false
  for (const child of node.children) {
    if (child.type !== 'text') { text = false; continue }
    if (!child.value || text) continue
    starts.push(child.position ? at(child) : '-')
    text = true
  }
  return starts.join(' ')
}

// rehype-katex replaces each math element (`$x$`, or `$$` … `$$`, which is a <pre>) with one KaTeX element that has no
// position: give that element the position of the math it replaced. `withMathPositions(rehypeKatex)` is rehype-katex.
const isMath = (node) => node.type === 'element' && ['language-math', 'math-inline', 'math-display'].some((c) => node.properties?.className?.includes?.(c))
export function withMathPositions(plugin) {
  return function (...options) {
    const transform = plugin.apply(this, options)
    return (tree, file) => {
      const found = [] // [parent, index, position] of each math element
      const visit = (node) => {
        node.children?.forEach((child, index) => {
          const math = isMath(child) ? child : child.tagName === 'pre' && child.children?.length === 1 && isMath(child.children[0]) ? child.children[0] : null
          if (math && (child.position || math.position)) found.push([node, index, child.position ?? math.position])
          else visit(child)
        })
      }
      if (on) visit(tree)
      const result = transform(tree, file)
      for (const [parent, index, position] of found) if (parent.children[index] && !parent.children[index].position) parent.children[index].position = position
      return result
    }
  }
}

export function rehypeSourcePositions() {
  return (tree, file) => {
    const path = file.path ?? file.history?.at(-1)
    if (!on || !path || typeof file.value !== 'string') return
    const version = versionOf(file.value)
    saved.delete(version)
    saved.set(version, file.value)
    if (saved.size > KEEP) saved.delete(saved.keys().next().value)
    const name = relative(root, path)
    const visit = (node, inside) => {
      const marked = isTag(node) && !!node.position
      if (marked) {
        setAttribute(node, 'data-src', `${at(node)}-${node.position.end.line}:${node.position.end.column}`)
        const texts = textStarts(node)
        if (texts) setAttribute(node, 'data-src-text', texts)
        if (!inside) {
          setAttribute(node, 'data-src-file', name)
          setAttribute(node, 'data-src-version', version)
        }
      }
      for (const child of node.children ?? []) visit(child, inside || marked)
    }
    visit(tree, false)
  }
}
