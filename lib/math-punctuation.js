// rehype plugin, after KaTeX: keep inline math on one line with the punctuation that touches it.
//
// KaTeX draws inline math as inline-block boxes, and a browser may break the line between the last box and a "." or ","
// that follows it, so the punctuation starts the next line. This wraps the math, the closing punctuation right after it
// and an opening bracket right before it in <span class="math-nowrap">, an inline-block (site.css), so that no line breaks between them.
// `white-space: nowrap` on the following text, or a word joiner (U+2060), does not stop Chrome from breaking there.
// Display math is left alone.

const CLOSING = /^[.,;:!?)\]}’”…]+/
const OPENING = /[([{‘“]$/

const isInlineMath = (node) => node?.type === 'element' && node.properties?.className?.includes?.('katex')

function visit(node) {
  if (!node.children) return
  if (node.properties?.className?.includes?.('katex-display')) return
  for (let i = 0; i < node.children.length; i++) {
    const math = node.children[i]
    if (!isInlineMath(math)) {
      visit(math)
      continue
    }
    const before = node.children[i - 1]
    const after = node.children[i + 1]
    const closing = after?.type === 'text' ? after.value.match(CLOSING)?.[0] : null
    const opening = before?.type === 'text' ? before.value.match(OPENING)?.[0] : null
    if (!closing && !opening) continue
    const held = [math]
    if (closing) {
      held.push({ type: 'text', value: closing })
      after.value = after.value.slice(closing.length)
    }
    if (opening) {
      held.unshift({ type: 'text', value: opening })
      before.value = before.value.slice(0, -opening.length)
    }
    node.children[i] = { type: 'element', tagName: 'span', properties: { className: ['math-nowrap'] }, children: held }
  }
  node.children = node.children.filter((child) => child.type !== 'text' || child.value !== '')
}

export default function rehypeMathPunctuation() {
  return (tree) => visit(tree)
}
