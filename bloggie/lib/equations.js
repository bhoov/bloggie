// remark plugin: numbered equations and figures, and references to them, in MDX pages (as in Quarto).
//
//   $$
//   \label{eq-id}            The nth labelled display equation is numbered (n), with KaTeX's \tag,
//   E = …                    and wrapped in <div id="eq-id"> so prose can link to it.
//   $$                       (Put \label on its own line: text after the opening $$ is not math.)
//
//   <div id="fig-id">…</div>  An element whose id starts with "fig-" is the nth figure. Its caption gets
//                            "Figure n." from a CSS counter (site.css), in the same document order.
//
//   [](#eq-id), [](#fig-id)  A link with empty text renders as "Eq. (n)" or "Fig. n".
//
// Front matter `equationNumbers: false` keeps labels as anchors without numbers. A duplicate label,
// or an empty link that is not a numbered equation or figure, fails the build.

const LABEL = /\\label\{([A-Za-z0-9_-]+)\}/

// Depth-first walk that lets the callback replace parent.children[index].
function walk(node, visit, parent = null, index = 0) {
  visit(node, parent, index)
  const current = parent ? parent.children[index] : node
  current.children?.forEach((_, i) => walk(current.children[i], visit, current, i))
}

// Replace the first text node under `children` (remark-math's hChildren) with `value`.
function setText(children, value) {
  for (const child of children ?? []) {
    if (child.type === 'text') { child.value = value; return true }
    if (setText(child.children, value)) return true
  }
  return false
}

export default function remarkEquations() {
  return (tree, file) => {
    const numbered = file.data.astro?.frontmatter?.equationNumbers !== false
    const numbers = new Map()
    walk(tree, (node, parent, index) => {
      if (node.type !== 'math' || !parent) return
      const match = node.value.match(LABEL)
      if (!match) return
      const id = match[1]
      if (numbers.has(id)) throw new Error(`${file.path}: equation label "${id}" is used twice`)
      numbers.set(id, numbers.size + 1)
      node.value = node.value.replace(LABEL, '').trim() + (numbered ? ` \\tag{${numbers.get(id)}}` : '')
      setText(node.data?.hChildren, node.value) // remark-math renders from this copy of the TeX
      parent.children[index] = { type: 'labelledEquation', data: { hName: 'div', hProperties: { id } }, children: [node] }
    })
    const figures = new Map()
    walk(tree, (node) => {
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return
      const id = node.attributes?.find((a) => a.name === 'id')?.value
      if (typeof id !== 'string' || !id.startsWith('fig-')) return
      if (figures.has(id)) throw new Error(`${file.path}: figure id "${id}" is used twice`)
      figures.set(id, figures.size + 1)
    })
    walk(tree, (node) => {
      if (node.type !== 'link' || node.children.length || !node.url.startsWith('#')) return
      const id = node.url.slice(1)
      const eq = numbered && numbers.get(id)
      const fig = figures.get(id)
      if (!eq && !fig) throw new Error(`${file.path}: [](${node.url}) has no text, so it must point to a numbered equation or figure`)
      node.children = [{ type: 'text', value: eq ? `Eq.\u00a0(${eq})` : `Fig.\u00a0${fig}` }]
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: [eq ? 'eqref' : 'figref'] } }
    })
  }
}
