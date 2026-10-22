// Heading shorthand for slide decks (remark plugin; runs only on files named slides.mdx).
//
//   # Title            the first `#` is the title slide; the paragraph under it is the byline.
//                      Every later `#` is a divider.
//   ## Title           starts a slide (kind "text"); the slide runs to the next `#` or `##`.
//   ## [equation] Title          a kind, then optional settings:
//   ## [demo zoom=1.5 svgMax=390px] Title
//   ## [text titleStyle="font-size: 60px"] Title     a quoted value may hold spaces
//
// Everything else is the slide's body, as written: Markdown, math, figure tags, <Notes>.
// Each slide becomes the <Slide> component (bloggie/components/slides/Slide.astro) with the heading as
// its title, so a hand-written <Slide> and a shorthand slide render the same. A hand-written
// <Slide> can sit between shorthand slides. The plugin imports Slide and Notes itself.
//
// A block of a slide's body can carry CSS, which the slide editor (bloggie/editor/) writes:
//
//   <Box style="translate: 0 -40px; font-size: 44px">
//   - **One** item
//   </Box>
//
// Box is not an element: rehypeSlideBoxes (below) puts its style on the element its content
// renders to (here the <ul>), so the slide's structure and CSS selectors stay as they were. A Box
// around a figure tag, or around several blocks, renders as <div class="slide-box">. A Box's
// `inner` holds CSS rules for elements inside the block, such as a figure's labels; each selector
// starts at a child of that element (bloggie/editor/css.js):
//
//   <Box inner="li:nth-of-type(2) > span.mark { font-size: 60px }">
//
// Every figure tag in a deck (a component imported from src/figures/) gets medium="slide" unless it
// sets medium itself, so a figure can draw its slide version; in a post it is medium="blog".
import { createHash } from 'node:crypto'
import { parseRules, scopeRules } from '../editor/css.js'

const SLIDE = '@bloggie/components/slides/Slide.astro'
const NOTES = '@bloggie/components/slides/Notes.astro'
const TAG = /^\[([a-z]+)((?:\s+[A-Za-z]+=(?:"[^"\]]*"|[^\s\]"]+))*)\]\s*/
const SETTING = /([A-Za-z]+)=(?:"([^"\]]*)"|([^\s\]"]+))/g

const attribute = (name, value) => ({ type: 'mdxJsxAttribute', name, value: String(value) })
const element = (name, attributes, children) => ({ type: 'mdxJsxFlowElement', name, attributes, children })
const attr = (node, name) => node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)?.value

// Plain text of a heading, for the speaker view's "next:" line; math keeps its TeX.
const plain = (node) => node.type === 'mdxJsxTextElement' && node.name === 'br' ? ' ' : (node.value ?? '') + (node.children ?? []).map(plain).join('')

// A default import as an MDX ESM node; the estree is what the MDX compiler reads.
function importNode(name, source) {
  return {
    type: 'mdxjsEsm',
    value: `import ${name} from '${source}'`,
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        body: [{
          type: 'ImportDeclaration',
          specifiers: [{ type: 'ImportDefaultSpecifier', local: { type: 'Identifier', name } }],
          source: { type: 'Literal', value: source, raw: `'${source}'` },
        }],
      },
    },
  }
}

// Read the optional [kind key=value …] tag at the start of a heading, and remove it. The tag is read
// from the file's source when there is one: smartypants has already curled the quotes in the text.
function readTag(heading, source) {
  const first = heading.children[0]
  if (first?.type !== 'text') return { kind: null, settings: {} }
  const raw = source && heading.position ? source.slice(heading.position.start.offset, heading.position.end.offset).replace(/^#+[ \t]+/, '') : first.value
  const match = raw.match(TAG)
  if (!match || !first.value.startsWith('[')) return { kind: null, settings: {} }
  first.value = first.value.replace(/^\[[^\]]*\]\s*/, '')
  const settings = Object.fromEntries([...match[2].matchAll(SETTING)].map(([, name, quoted, bare]) => [name, quoted ?? bare]))
  return { kind: match[1], settings }
}

// The heading each shorthand slide came from, for the slide editor, which edits the heading's tag.
export const headingOf = new WeakMap()

export function slidesFromHeadings(tree, source) {
  const out = []
  let slide = null // { heading, kind, settings, body }
  let sawTitle = false
  const close = () => {
    if (!slide) return
    const { heading, kind, settings, body } = slide
    const title = element('span', [attribute('slot', 'title')], heading.children)
    const attributes = [attribute('kind', kind), attribute('label', plain(heading).trim()),
      ...Object.entries(settings).map(([name, value]) => attribute(name, value))]
    const node = element('Slide', attributes, [title, ...body])
    headingOf.set(node, heading)
    out.push(node)
    slide = null
  }
  for (const node of tree.children) {
    const isSlideHeading = node.type === 'heading' && node.depth <= 2
    const isHandWritten = node.type === 'mdxJsxFlowElement' && node.name === 'Slide'
    const stays = node.type === 'mdxjsEsm' || node.type === 'yaml' || node.type === 'toml'
    if (isSlideHeading) {
      close()
      const { kind, settings } = readTag(node, source)
      const implied = node.depth === 1 ? (sawTitle ? 'divider' : 'title') : 'text'
      if (node.depth === 1) sawTitle = true
      slide = { heading: node, kind: kind ?? implied, settings, body: [] }
    } else if (isHandWritten) {
      close()
      sawTitle = true
      out.push(node)
    } else if (slide && !stays) {
      slide.body.push(node)
    } else {
      out.push(node)
    }
  }
  close()
  // Import Slide and Notes unless the deck already does.
  const imported = new Set(out.filter((n) => n.type === 'mdxjsEsm').map((n) => n.value.match(/import\s+(\w+)/)?.[1]))
  const imports = [['Slide', SLIDE], ['Notes', NOTES]].filter(([name]) => !imported.has(name)).map(([name, source]) => importNode(name, source))
  tree.children = [...imports, ...out]
}

// The blocks of a slide, in order: its body's paragraphs, lists, equations, code, figure tags and
// elements, each a Box if it has one. Not blocks: the title, <Notes>, comments and definitions,
// which render nothing where they stand. The slide editor names a block by its slide and position
// here ("3/1"), in the page and in the source, so both must list blocks with this function.
export function slideBlocks(slide) {
  return slide.children.filter((node) => {
    if (node.type === 'mdxFlowExpression' || node.type === 'definition' || node.type === 'footnoteDefinition') return false
    if (node.type === 'text' && !node.value.trim()) return false
    if (node.type === 'mdxJsxFlowElement' && (node.name === 'Notes' || attr(node, 'slot') === 'title')) return false
    return true
  })
}

const isComponent = (node) => node.type === 'mdxJsxFlowElement' && /^[A-Z]/.test(node.name ?? '') && node.name !== 'Box'

// A block the editor can select: a component that goes to a named slot (other than a Box) has no
// fixed place in the page to mark.
export const isEditable = (node) => !(isComponent(node) && attr(node, 'slot'))

// Dev only (the slide editor turns it on): mark each slide with its index and each block with its
// id, so that the editor can find the source of what the reader clicks. A Box or an element takes
// a data-edit attribute; other blocks are wrapped in a Box that has only data-edit.
let markBlocks = false
export const setMarkBlocks = (on) => { markBlocks = on }

// A short hash of a text: the version of a render, and the editor's fingerprint of a slide or block.
export const versionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

function markForEditor(tree, source) {
  // The version of the text this page renders from, which the editor waits for after it writes.
  if (source != null) tree.children.unshift(element('template', [attribute('data-edit-version', versionOf(source))], []))
  const slides = tree.children.filter((n) => n.type === 'mdxJsxFlowElement' && n.name === 'Slide')
  slides.forEach((slide, i) => {
    slide.attributes.push(attribute('edit', i))
    const blocks = slideBlocks(slide)
    slide.children = slide.children.map((node) => {
      const j = blocks.indexOf(node)
      if (j < 0 || !isEditable(node)) return node
      const id = attribute('data-edit', `${i}/${j}`)
      if (node.type === 'mdxJsxFlowElement' && !isComponent(node)) {
        node.attributes.push(id)
        return node
      }
      return element('Box', [id], [node])
    })
  })
}

// medium="slide" on each tag of a component imported from src/figures/, unless it sets medium.
function markMedium(tree) {
  const figures = new Set()
  for (const node of tree.children) {
    if (node.type !== 'mdxjsEsm') continue
    for (const [, name, from] of node.value.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) if (/(^|\/)figures\//.test(from)) figures.add(name)
  }
  const visit = (node) => {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && figures.has(node.name) && !node.attributes.some((a) => a.name === 'medium')) node.attributes.push(attribute('medium', 'slide'))
    node.children?.forEach(visit)
  }
  visit(tree)
}

export default function remarkSlideHeadings() {
  return (tree, file) => {
    const path = file.path ?? file.history?.at(-1) ?? ''
    if (!path.endsWith('slides.mdx')) return
    slidesFromHeadings(tree, typeof file.value === 'string' ? file.value : undefined)
    markMedium(tree)
    if (markBlocks) markForEditor(tree, typeof file.value === 'string' ? file.value : null)
  }
}

// rehype plugin, after KaTeX: each Box gives its style (and, under the editor, its data-edit) to
// the one element its content rendered to, and is removed. A Box around a figure tag, or around
// several blocks, becomes <div class="slide-box">; a Box with only data-edit around a figure tag
// leaves the figure where it was, after a <template data-edit> that the editor reads. A Box's inner
// rules become a <style> before its element, scoped to the element's id.
const isBox = (node) => node.type === 'mdxJsxFlowElement' && node.name === 'Box'
const blank = (node) => node.type === 'text' && !node.value.trim()
const idSelector = (id) => (/^[A-Za-z_][\w-]*$/.test(id) ? `#${id}` : `[id="${id.replace(/["\\]/g, '\\$&')}"]`)
const styleFor = (id, rules) => ({ type: 'element', tagName: 'style', properties: { dataBox: id }, children: [{ type: 'text', value: scopeRules(rules, idSelector(id)) }] })

function stringAttr(box, name) {
  const value = attr(box, name)
  if (value != null && typeof value !== 'string') throw new Error(`<Box>: ${name} must be a string of CSS, such as style="font-size: 44px"`)
  return value
}

function unwrapBox(box, nextId) {
  const style = stringAttr(box, 'style')
  const rules = parseRules(stringAttr(box, 'inner') ?? '').filter(([, d]) => d.length)
  const edit = attr(box, 'data-edit')
  const children = box.children.filter((c) => !blank(c))
  const [only] = children
  if (children.length === 1 && only.type === 'element') {
    only.properties ??= {}
    if (style) only.properties.style = [only.properties.style, style].filter(Boolean).join('; ').replace(/;\s*;/g, ';')
    if (edit) only.properties.dataEdit = edit
    if (!rules.length) return [only]
    only.properties.id ??= nextId()
    return [styleFor(String(only.properties.id), rules), only]
  }
  if (children.length === 1 && only.type === 'mdxJsxFlowElement' && !isComponent(only)) {
    const own = only.attributes.find((a) => a.name === 'style')
    if (style && own && typeof own.value === 'string') own.value = [own.value, style].join('; ')
    else if (style) only.attributes.push(attribute('style', style))
    if (edit) only.attributes.push(attribute('data-edit', edit))
    if (!rules.length) return [only]
    let id = attr(only, 'id')
    if (typeof id !== 'string') only.attributes.push(attribute('id', (id = nextId())))
    return [styleFor(id, rules), only]
  }
  if (style == null && !rules.length) {
    const marker = { type: 'element', tagName: 'template', properties: { dataEdit: edit }, children: [] }
    return edit ? [marker, ...box.children] : box.children
  }
  const className = attr(box, 'class')
  const id = rules.length ? nextId() : null
  box.name = 'div'
  box.attributes = [attribute('class', ['slide-box', className].filter(Boolean).join(' ')), ...(style ? [attribute('style', style)] : []), ...(id ? [attribute('id', id)] : []), ...(edit ? [attribute('data-edit', edit)] : [])]
  return id ? [styleFor(id, rules), box] : [box]
}

export function rehypeSlideBoxes() {
  return (tree, file) => {
    const path = file.path ?? file.history?.at(-1) ?? ''
    if (!path.endsWith('slides.mdx')) return
    let count = 0
    const nextId = () => `slide-box-${++count}`
    const visit = (node) => {
      if (!node.children) return
      node.children.forEach(visit)
      if (node.children.some(isBox)) node.children = node.children.flatMap((child) => (isBox(child) ? unwrapBox(child, nextId) : [child]))
    }
    visit(tree)
  }
}
