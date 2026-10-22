// Source edits for the slide editor: find a block of a deck in its slides.mdx, and rewrite the
// block's CSS or its text, or copy or delete a block or a whole slide. Each edit takes the file's
// text and returns the new text; the dev server (integration.js) writes it. A block is named as in
// the page, "<slide>/<block>" ("3/1"), or "<slide>/t" for the slide's title, with the indexes of
// slidesFromHeadings and slideBlocks (bloggie/lib/slide-headings.js), which the page's markers come
// from too.
//
// Where the CSS goes:
//   a Markdown block or a figure tag   <Box style="…"> around it (a new Box when it has none)
//   an element, such as <p slot="note">  its own style attribute
//   a heading's title                  titleStyle="…" in the heading's [kind …] tag
//   a hand-written <Slide>'s title     its titleStyle attribute
//   an element inside a block          <Box inner="<selector> { … }">: CSS rules for the block's
//                                      insides, such as a figure's labels (a Box around an element
//                                      too; see bloggie/editor/css.js)
// Removing the last property removes what the edit added, so the file returns to its text.
//
// Every edit is checked before it is returned: the new text must parse, and a change of CSS must
// leave every slide with the blocks it had.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { headingOf, isEditable, slideBlocks, slidesFromHeadings, versionOf } from '../lib/slide-headings.js'
import { formatRules, formatStyle, parseRules, parseStyle } from './css.js'
import { canonical, countBefore, nth } from './text.js'

// The syntax MDX sees in a deck (astro.config.mjs): MDX, GFM, then math.
const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkMath)

export class EditError extends Error {}

const HEADING = /^(#{1,2}[ \t]+)(?:\[([a-z]+)((?:\s+[A-Za-z]+=(?:"[^"\]]*"|[^\s\]"]+))*)\][ \t]*)?/
const SETTING = /([A-Za-z]+)=(?:"([^"\]]*)"|([^\s\]"]+))/g
const PROPERTY = /^(--)?[a-z][a-z0-9-]*$/
const UNSAFE_VALUE = /[;"{}<>\]\n]/
const UNSAFE_SELECTOR = /[{};"<\n]/

const splice = (text, start, end, insert) => text.slice(0, start) + insert + text.slice(end)
const span = (node) => ({ start: node.position.start.offset, end: node.position.end.offset })
const attribute = (node, name) => node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)
const isJsx = (node) => node.type === 'mdxJsxFlowElement'
const isBox = (node) => isJsx(node) && node.name === 'Box'
const isElement = (node) => isJsx(node) && /^[a-z]/.test(node.name ?? '')
const isComponent = (node) => isJsx(node) && /^[A-Z]/.test(node.name ?? '') && !isBox(node)
const lineIndent = (source, start) => source.slice(source.lastIndexOf('\n', start - 1) + 1, start)

// Astro hands MDX the file with its front matter replaced by spaces, so offsets match the file.
const FRONTMATTER = /(?:^﻿?|^\s*\n)(---|\+\+\+)([\s\S]*?\n)(?:---|\+\+\+)/
function blankFrontmatter(source) {
  const match = FRONTMATTER.exec(source)
  if (!match) return source
  const [, delims, raw] = match
  return source.replace(`${delims}${raw}${delims}`, () => `   ${raw.replace(/[^\r\n]/g, ' ')}   `)
}

// MDX turns a paragraph that holds only JSX (`<p slot="note">…</p>` on one line) into that JSX
// before the deck's plugins run (@mdx-js/mdx's remark-mark-and-unravel); do the same here.
function unravel(node) {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    unravel(child)
    if (child.type !== 'paragraph') return [child]
    const blank = (c) => c.type === 'text' && !/[^\t\n\f\r ]/.test(c.value)
    const jsx = (c) => c.type === 'mdxJsxTextElement' || c.type === 'mdxTextExpression'
    if (!child.children.every((c) => jsx(c) || blank(c)) || !child.children.some(jsx)) return [child]
    return child.children.filter(jsx).map((c) => ({ ...c, type: c.type === 'mdxJsxTextElement' ? 'mdxJsxFlowElement' : 'mdxFlowExpression' }))
  })
}

// An edit parses the file, checks its new text by parsing it, and the dev server then outlines that
// text: the last few parses are kept, by their text, so each version of the file is parsed once. The
// slides are only read, never changed, after parse returns them.
const parsed = new Map()
function parse(source) {
  let slides = parsed.get(source)
  if (!slides) {
    slides = parseText(source)
    if (parsed.size >= 4) parsed.delete(parsed.keys().next().value)
  } else parsed.delete(source)
  parsed.set(source, slides)
  return slides
}

function parseText(source) {
  const text = blankFrontmatter(source)
  let tree
  try {
    tree = parser.parse(text)
  } catch (error) {
    throw new EditError(`slides.mdx would not parse: ${error.reason ?? error.message}${error.line ? ` (line ${error.line})` : ''}`)
  }
  unravel(tree)
  const imports = tree.children.filter((n) => n.type === 'mdxjsEsm' && n.position)
  slidesFromHeadings(tree, text)
  let sawTitle = false
  const slides = tree.children.filter((n) => isJsx(n) && n.name === 'Slide').map((node, i) => {
    const heading = headingOf.get(node) ?? null
    const implied = !heading || heading.depth === 2 ? 'text' : sawTitle ? 'divider' : 'title'
    if (!heading || heading.depth === 1) sawTitle = true
    const kind = attribute(node, 'kind')?.value ?? 'text'
    const blocks = slideBlocks(node).map((block, j) => ({ node: block, id: `${i}/${j}`, editable: isEditable(block) }))
    return { index: i, node, heading, kind, implied, blocks }
  })
  slides.imports = imports
  return slides
}

// The deck as the editor sees it: each slide's kind and the ids of the blocks it can select.
// For each slide, hashes of its parts: the page compares them before and after an edit, and draws
// again only the slides and blocks whose source changed (patch.js).
//   hash    the slide's whole text        head    its [kind …] tag (or <Slide …> tag)
//   title   its title's text              hashes  each selectable block's text, as in `blocks`
//   opaque  its other blocks (a figure tag in a named slot), which the page cannot draw one by one
export function outline(source) {
  const slides = parse(source)
  return {
    render: renderVersion(source),
    slides: slides.map((s, i) => {
      const { start, end } = slideSpan(source, slides, i, { imports: false })
      let head
      let title
      if (s.heading) {
        const h = readHeading(source, s)
        head = h.prefix
        title = source.slice(h.titleStart, h.end)
      } else {
        const first = s.node.children.find((c) => c.position)
        head = source.slice(span(s.node).start, first ? span(first).start : span(s.node).end)
        title = head
      }
      const editable = s.blocks.filter((b) => b.editable)
      return {
        kind: s.kind,
        blocks: editable.map((b) => b.id),
        hash: hash(source.slice(start, end)),
        head: hash(head),
        title: hash(title),
        hashes: editable.map((b) => hash(source.slice(span(b.node).start, span(b.node).end))),
        opaque: hash(s.blocks.filter((b) => !b.editable).map((b) => source.slice(span(b.node).start, span(b.node).end)).join('\n')),
      }
    }),
  }
}

const hash = (text) => versionOf(text)

// The version of the page Astro renders from this source: the page's <template data-edit-version>
// (bloggie/lib/slide-headings.js) holds the same hash of the text it was rendered from.
export const renderVersion = (source) => versionOf(blankFrontmatter(source))

function find(slides, id) {
  const match = /^(\d+)\/(t|\d+)$/.exec(String(id))
  if (!match) throw new EditError(`"${id}" is not a block id`)
  const slide = slides[Number(match[1])]
  if (!slide) throw new EditError(`there is no slide ${Number(match[1]) + 1}`)
  if (match[2] === 't') return { slide, title: true }
  const index = Number(match[2])
  const block = slide.blocks[index]
  if (!block?.editable) throw new EditError(`slide ${slide.index + 1} has no block ${index + 1}`)
  return { slide, block: block.node, index }
}

function findSlide(slides, index) {
  const slide = slides[Number(index)]
  if (!slide) throw new EditError(`there is no slide ${Number(index) + 1}`)
  return slide
}

// Set each property of `set` (null removes it); a new property goes last.
function mergeStyle(style, set) {
  const declarations = parseStyle(style)
  for (const [property, value] of Object.entries(set)) {
    if (!PROPERTY.test(property)) throw new EditError(`"${property}" is not a CSS property`)
    if (value != null && (UNSAFE_VALUE.test(String(value)) || !String(value).trim())) throw new EditError(`"${value}" is not a value the editor writes`)
    const at = declarations.findIndex(([p]) => p === property)
    if (value == null) { if (at >= 0) declarations.splice(at, 1) }
    else if (at >= 0) declarations[at][1] = String(value)
    else declarations.push([property, String(value)])
  }
  return formatStyle(declarations)
}

// --- JSX attributes and heading tags -------------------------------------------

const quoted = (value) => {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  throw new EditError('a value cannot hold both kinds of quote')
}

// Set a string attribute of a JSX element in the source, or remove it (value null).
function setAttribute(source, node, name, value) {
  const own = attribute(node, name)
  if (own && own.value != null && typeof own.value !== 'string') throw new EditError(`${name} is a JavaScript expression; edit it in slides.mdx`)
  if (own) {
    const { start, end } = span(own)
    if (value != null) return splice(source, start, end, `${name}=${quoted(value)}`)
    let from = start
    while (from > 0 && /[ \t]/.test(source[from - 1])) from--
    return splice(source, from, end, '')
  }
  if (value == null) return source
  const last = node.attributes.at(-1)
  const at = last?.position ? span(last).end : span(node).start + 1 + node.name.length
  return splice(source, at, at, ` ${name}=${quoted(value)}`)
}

const stringAttribute = (node, name) => {
  const value = attribute(node, name)?.value
  if (value != null && typeof value !== 'string') throw new EditError(`${name} is a JavaScript expression; edit it in slides.mdx`)
  return value ?? ''
}

// The raw text of a string attribute, between its quotes.
function attributeText(source, node, name) {
  const own = attribute(node, name)
  if (!own) return null
  if (typeof own.value !== 'string') throw new EditError(`${name} is a JavaScript expression; edit it in slides.mdx`)
  const { start, end } = span(own)
  const raw = source.slice(start, end)
  const open = raw.indexOf('=') + 1
  return { start: start + open + 1, end: end - 1, text: raw.slice(open + 1, -1) }
}

// A shorthand slide's heading line: the `#`s, its tag's kind and settings, and its title text.
function readHeading(source, slide) {
  const { start, end } = span(slide.heading)
  const line = source.slice(start, end)
  const match = line.match(HEADING)
  if (!match) throw new EditError(`the title of slide ${slide.index + 1} is not a # heading`)
  const settings = [...(match[3] ?? '').matchAll(SETTING)].map(([, name, q, bare]) => [name, q ?? bare])
  return { start, end, prefix: match[0], hashes: match[1], kind: match[2] ?? null, settings, titleStart: start + match[0].length }
}

function setTitleStyle(source, slide, style) {
  if (!slide.heading) return setAttribute(source, slide.node, 'titleStyle', style || null)
  const h = readHeading(source, slide)
  const settings = h.settings.filter(([name]) => name !== 'titleStyle')
  if (style) settings.push(['titleStyle', style])
  const kind = h.kind ?? slide.kind
  const keep = settings.length || kind !== slide.implied
  const tag = keep ? `[${kind}${settings.map(([n, v]) => ` ${n}=${/[\s"]/.test(v) ? `"${v}"` : v}`).join('')}] ` : ''
  return splice(source, h.start, h.titleStart, h.hashes + tag)
}

function titleStyle(source, slide) {
  if (!slide.heading) return stringAttribute(slide.node, 'titleStyle')
  return readHeading(source, slide).settings.find(([name]) => name === 'titleStyle')?.[1] ?? ''
}

// --- blocks ------------------------------------------------------------------------

// A Box around one element (<p slot="note">): the element keeps its own style attribute.
const boxedElement = (block) => (isBox(block) && block.children.length === 1 && isElement(block.children[0]) ? block.children[0] : null)
const styleHolder = (block) => (isElement(block) ? block : boxedElement(block) ?? (isBox(block) ? block : null))
const blockStyle = (block) => (styleHolder(block) ? stringAttribute(styleHolder(block), 'style') : '')
const blockInner = (block) => (isBox(block) ? stringAttribute(block, 'inner') : '')

// Where a block's own text is: inside its Box, or inside an element's tags.
function innerSpan(block) {
  const holder = boxedElement(block) ?? block
  const kids = (isBox(holder) || isElement(holder)) && holder.children.filter((c) => c.position)
  if (!kids?.length) return span(holder)
  return { start: span(kids[0]).start, end: span(kids.at(-1)).end }
}

function wrap(source, block, attributes, blankLines) {
  const { start, end } = span(block)
  const indent = lineIndent(source, start)
  if (indent.trim()) throw new EditError('this block does not start its line')
  const gap = blankLines ? `\n\n${indent}` : `\n${indent}`
  const attrs = attributes.map(([name, value]) => ` ${name}=${quoted(value)}`).join('')
  return splice(source, start, end, `<Box${attrs}>${gap}${source.slice(start, end)}${gap}</Box>`)
}

// Set (or remove, with '') one of a block's Box attributes, style or inner. An element's style is
// its own attribute. A Box left with no attributes is removed, and its content stays.
function setBlockAttribute(source, block, name, value, blankLines) {
  if (name === 'style' && (isElement(block) || boxedElement(block))) return setAttribute(source, styleHolder(block), 'style', value || null)
  if (isBox(block)) {
    if (value || block.attributes.some((a) => a.name !== name)) return setAttribute(source, block, name, value || null)
    const { start, end } = span(block)
    const kids = block.children.filter((c) => c.position)
    return splice(source, start, end, kids.length ? source.slice(span(kids[0]).start, span(kids.at(-1)).end) : '')
  }
  return value ? wrap(source, block, [[name, value]], blankLines) : source
}

// A figure tag gets a <div class="slide-box"> around it once its Box has a style or inner rules;
// the page cannot draw that change itself, so it reloads. Other changes of CSS update it in place.
const figureBox = (block) => isComponent(block) || (isBox(block) && (block.children.length !== 1 || isComponent(block.children[0])))
const hasWrapper = (block, style, inner) => figureBox(block) && !!(style || inner)

// The same slides, with the same number of blocks each: a change of CSS must not change the deck.
const sameShape = (a, b) => a.length === b.length && a.every((s, i) => s.blocks.length === b[i].blocks.length)

// Write a change of CSS, then check it: the deck keeps its shape, and the block reads back as written.
function writeChecked(slides, id, attempt, readBack, expected) {
  for (const blankLines of [false, true]) {
    const next = attempt(blankLines)
    const check = parse(next)
    if (sameShape(slides, check) && readBack(next, find(check, id)) === expected) return next
  }
  throw new EditError('the editor could not write this style without changing the slide; edit slides.mdx by hand')
}

export function readBlock(source, id) {
  const slides = parse(source)
  const { slide, block, title } = find(slides, id)
  if (title) {
    if (slide.heading) {
      const h = readHeading(source, slide)
      return { style: titleStyle(source, slide), inner: '', text: source.slice(h.titleStart, h.end), singleLine: true }
    }
    const t = attributeText(source, slide.node, 'title')
    if (!t) throw new EditError(`slide ${slide.index + 1} has no title to edit`)
    return { style: titleStyle(source, slide), inner: '', text: t.text, singleLine: true }
  }
  const { start, end } = innerSpan(block)
  return { style: blockStyle(block), inner: blockInner(block), text: source.slice(start, end), singleLine: false }
}

// A change of CSS: `set` maps each property to its new value, or to null to remove it. Returns the
// new source, whether the page must reload, and the edit that undoes it.
function editStyle(source, id, set) {
  const slides = parse(source)
  const { slide, block, title } = find(slides, id)
  const before = title ? titleStyle(source, slide) : blockStyle(block)
  const old = Object.fromEntries(parseStyle(before))
  const inverse = { type: 'style', id, set: Object.fromEntries(Object.keys(set).map((p) => [p, old[p] ?? null])) }
  const after = mergeStyle(before, set)
  if (after === before) return { source, reload: false, inverse, unchanged: true }
  const next = title
    ? writeChecked(slides, id, () => setTitleStyle(source, slide, after), (text, f) => titleStyle(text, f.slide), after)
    : writeChecked(slides, id, (blank) => setBlockAttribute(source, block, 'style', after, blank), (text, f) => blockStyle(f.block), after)
  const inner = title ? '' : blockInner(block)
  return { source: next, reload: !title && hasWrapper(block, before, inner) !== hasWrapper(block, after, inner), inverse }
}

// A change of CSS inside a block: the rule for `selector` in the block's Box `inner`.
function editInner(source, id, selector, set) {
  if (typeof selector !== 'string' || !selector.trim() || UNSAFE_SELECTOR.test(selector)) throw new EditError(`"${selector}" is not a selector the editor writes`)
  const slides = parse(source)
  const { block, title } = find(slides, id)
  if (title) throw new EditError('the editor styles what is inside a block, not inside a title')
  const before = blockInner(block)
  const rules = parseRules(before)
  let rule = rules.find(([s]) => s === selector.trim())
  if (!rule) rules.push((rule = [selector.trim(), []]))
  const old = Object.fromEntries(rule[1])
  const inverse = { type: 'inner', id, selector: rule[0], set: Object.fromEntries(Object.keys(set).map((p) => [p, old[p] ?? null])) }
  rule[1] = parseStyle(mergeStyle(formatStyle(rule[1]), set))
  const after = formatRules(rules)
  if (after === before) return { source, reload: false, inverse, unchanged: true }
  const next = writeChecked(slides, id, (blank) => setBlockAttribute(source, block, 'inner', after, blank), (text, f) => blockInner(f.block), after)
  const style = blockStyle(block)
  return { source: next, reload: hasWrapper(block, style, before) !== hasWrapper(block, style, after), inverse }
}

// A change of text: the block's Markdown (inside its Box or element), or the title's text.
function editText(source, id, text) {
  const slides = parse(source)
  const { slide, block, title } = find(slides, id)
  let next
  if (title) {
    const line = text.replace(/\s*\n\s*/g, ' ').trim()
    if (!line) throw new EditError('a title cannot be empty')
    if (slide.heading) next = splice(source, readHeading(source, slide).titleStart, span(slide.heading).end, line)
    else {
      const t = attributeText(source, slide.node, 'title')
      if (!t) throw new EditError(`slide ${slide.index + 1} has no title attribute`)
      if (line.includes(source[t.start - 1])) throw new EditError(`the title cannot hold ${source[t.start - 1]} here`)
      next = splice(source, t.start, t.end, line)
    }
  } else {
    if (!text.trim()) return removeBlock(source, id)
    const { start, end } = innerSpan(block)
    next = splice(source, start, end, text.replace(/\s+$/, ''))
  }
  parse(next)
  return { source: next, reload: true }
}

// Cut [start, end) out of the source, with the blank line that separated it from what follows.
function cut(source, start, end) {
  const before = source.slice(0, start).replace(/[ \t]+$/, '')
  const after = source.slice(end)
  return before + (before.endsWith('\n') ? after.replace(/^[ \t]*(\r?\n[ \t]*)*\r?\n/, '') : after)
}

function removeBlock(source, id) {
  const slides = parse(source)
  const { block, title } = find(slides, id)
  if (title) throw new EditError('a title cannot be deleted; delete the slide')
  const { start, end } = span(block)
  const next = cut(source, start, end)
  parse(next)
  return { source: next, reload: true }
}

// Insert `text` as a block of its own after offset `at` (the end of a block or heading).
function insertAfter(source, at, text) {
  const followed = source[at] === '\n' && source[at + 1] != null && source[at + 1] !== '\n'
  return splice(source, at, at, `\n\n${text}${followed ? '\n' : ''}`)
}

// A new paragraph after block `id` (or, for "<slide>/t", as the slide's first block).
function insertBlock(source, id, text) {
  const slides = parse(source)
  const { slide, block, title, index } = find(slides, id)
  const paragraph = (text ?? '').trim() || 'New text'
  let next
  let at = 0
  if (title && !slide.heading) {
    const first = slide.blocks[0]?.node
    if (!first) throw new EditError('add a first block to a hand-written <Slide> in slides.mdx')
    next = splice(source, span(first).start, span(first).start, `${paragraph}\n\n`)
  } else {
    next = insertAfter(source, title ? span(slide.heading).end : span(block).end, paragraph)
    at = title ? 0 : index + 1
  }
  if (parse(next)[slide.index]?.blocks.length !== slide.blocks.length + 1) throw new EditError('the new text did not become a block of its own; add it in slides.mdx')
  return { source: next, reload: true, id: `${slide.index}/${at}` }
}

// A copy of block `id` (with its Box), right after it.
function duplicateBlock(source, id) {
  const slides = parse(source)
  const { slide, block, title, index } = find(slides, id)
  if (title) throw new EditError('a title cannot be copied; duplicate the slide')
  const { start, end } = span(block)
  let copy = source.slice(start, end)
  // Two lists with one bullet character, one after the other, are one list in Markdown: the copy's
  // items take the other character (- and *, or 1. and 1)), which starts a list of its own.
  if (block.type === 'list') {
    const indent = lineIndent(source, start)
    const item = new RegExp(`^(${indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:([-*+])|(\\d+)([.)]))(?=[ \\t]|$)`, 'gm')
    copy = (indent + copy).replace(item, (_, lead, bullet, n, delim) => lead + (bullet ? (bullet === '-' ? '*' : '-') : n + (delim === '.' ? ')' : '.'))).slice(indent.length)
  }
  const next = insertAfter(source, end, lineIndent(source, start) + copy)
  if (parse(next)[slide.index]?.blocks.length !== slide.blocks.length + 1) throw new EditError('the copy did not become a block of its own; copy it in slides.mdx')
  return { source: next, reload: true, id: `${slide.index}/${index + 1}` }
}

// --- words inside a block: color, bold, italic ------------------------------------------------

// The source offset of each character of a text node's value. The value has escapes and character
// references resolved, and the indentation (or `> `) of continued lines taken out.
function offsetsOf(value, source, start, end) {
  const raw = source.slice(start, end)
  const out = []
  let r = 0
  for (let v = 0; v < value.length; v++) {
    const reference = raw.slice(r).match(/^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i)
    if (reference && value[v] !== '&') { out.push(start + r); r += reference[0].length; continue }
    if (raw[r] === '\\' && raw[r + 1] === value[v]) { out.push(start + r); r += 2; continue }
    while (r < raw.length && raw[r] !== value[v] && /[\s>]/.test(raw[r])) r++
    out.push(start + r)
    r++
  }
  return out
}

const BLOCKISH = new Set(['paragraph', 'listItem', 'list', 'blockquote', 'tableRow', 'tableCell', 'table', 'heading'])

// A block's text in the order the page shows it: one run per text node, inline code as one run to
// style whole, a space between paragraphs and list items. Math, figure tags and breaks show other
// text (or none) on the page; the page's side leaves them out too (client.js).
function textRuns(root, source, firstStart) {
  const runs = []
  const visit = (node, ancestors) => {
    if (node.type === 'text') {
      const { end } = span(node)
      const start = runs.every((r) => r.offsets[0] == null) && firstStart != null ? firstStart : span(node).start
      runs.push({ value: node.value, offsets: offsetsOf(node.value, source, start, end), end, node, ancestors })
    } else if (node.type === 'inlineCode') {
      const { start, end } = span(node)
      runs.push({ value: node.value, offsets: Array(node.value.length).fill(start), end, node, ancestors, whole: true })
    } else if (node.type === 'mdxJsxTextElement' && /^[A-Z]/.test(node.name ?? '')) {
      // a component: the page shows what it renders, not its source
    } else if (node.children && !['inlineMath', 'math', 'code', 'mdxTextExpression'].includes(node.type)) {
      node.children.forEach((child) => {
        if (BLOCKISH.has(child.type)) runs.push({ value: ' ', offsets: [null], ancestors })
        visit(child, [node, ...ancestors])
      })
    }
  }
  visit(root, [])
  return runs
}

// The node whose words a block's page text shows.
function wordsRoot(source, slide, block, title) {
  if (title) {
    if (!slide.heading) throw new EditError('select words of a hand-written <Slide>\'s title in slides.mdx')
    return { node: slide.heading, firstStart: readHeading(source, slide).titleStart }
  }
  let node = block
  if (isBox(node)) {
    const kids = node.children.filter((c) => c.position)
    if (kids.length !== 1) throw new EditError('this Box holds several blocks; select words in one of them in slides.mdx')
    node = kids[0]
  }
  if (node.type === 'code' || node.type === 'math') throw new EditError('code and equations are not styled word by word; select the whole block')
  if (isComponent(node)) throw new EditError('a figure\'s words are its own; ⌘+click one to style it on the slide')
  return { node }
}

const colorSpan = (node) => node?.type === 'mdxJsxTextElement' && node.name === 'span' && node.attributes.length === 1 && !!attribute(node, 'style') && parseStyle(stringAttribute(node, 'style')).every(([p]) => p === 'color')

// Color, bold or italic for the words selected on the page. `plain` is the block's text as the page
// has it, and [start, end) the selection in it; `color` is a CSS color (null takes color off), and
// `mark` is 'strong' or 'emphasis'. The words are found in the source by their canonical text
// (text.js), and each text node they touch gets its part wrapped: <span style="color: …">, ** or *.
function formatWords(source, id, { plain, start, end, color, mark }) {
  if (color != null && (UNSAFE_VALUE.test(String(color)) || !String(color).trim())) throw new EditError(`"${color}" is not a color the editor writes`)
  if (mark != null && mark !== 'strong' && mark !== 'emphasis') throw new EditError(`"${mark}" is not bold or italic`)
  const slides = parse(source)
  const { slide, block, title } = find(slides, id)
  const { node, firstStart } = wordsRoot(source, slide, block, title)
  const runs = textRuns(node, source, firstStart)
  // All the runs as one text, and for each of its characters the run and place it came from.
  let all = ''
  const origin = []
  runs.forEach((run, r) => { for (let v = 0; v < run.value.length; v++) { all += run.value[v]; origin.push([r, v]) } })
  const mine = canonical(all)
  const theirs = canonical(String(plain ?? ''))
  const a = theirs.at.findIndex((i) => i >= start)
  const bAt = theirs.at.findIndex((i) => i >= end)
  const b = bAt < 0 ? theirs.text.length : bAt
  const picked = a < 0 ? '' : theirs.text.slice(a, b)
  const words = picked.trim()
  if (!words) throw new EditError('select some words first')
  const from = a + picked.length - picked.trimStart().length
  let at = mine.text === theirs.text ? from : nth(mine.text, words, countBefore(theirs.text, words, from))
  if (at < 0 && mine.text.indexOf(words) >= 0 && mine.text.indexOf(words) === mine.text.lastIndexOf(words)) at = mine.text.indexOf(words)
  if (at < 0) throw new EditError('the selected words are not in slides.mdx as they read here; edit the Markdown instead (Enter)')

  // The part of each run the words cover, as a source range.
  const parts = new Map()
  for (let i = at; i < at + words.length; i++) {
    const [r, v] = origin[mine.at[i]]
    if (runs[r].offsets[v] == null || /\s/.test(runs[r].value[v])) continue
    const part = parts.get(r) ?? { run: runs[r], first: v, last: v }
    part.last = v
    parts.set(r, part)
  }
  const segments = [...parts.values()].map(({ run, first, last }) => {
    if (run.whole) return { run, ...span(run.node), whole: true }
    const stop = last + 1 < run.value.length ? run.offsets[last + 1] : run.end
    let e = stop
    while (e > run.offsets[first] && /\s/.test(source[e - 1])) e--
    return { run, start: run.offsets[first], end: e, whole: run.offsets[first] <= span(run.node).start && stop >= run.end }
  }).sort((x, y) => y.start - x.start)

  let next = source
  if (mark) {
    const inside = (seg) => seg.run.ancestors.find((n) => n.type === mark)
    const off = segments.every(inside)
    for (const seg of segments) {
      const wrapper = inside(seg)
      if (off) {
        // Take the mark off where it holds exactly these words.
        if (wrapper.children.length === 1 && seg.whole) {
          const outer = span(wrapper)
          const inner = span(wrapper.children[0])
          next = splice(next, outer.start, outer.end, next.slice(inner.start, inner.end))
        }
        continue
      }
      if (wrapper) continue
      const text = next.slice(seg.start, seg.end)
      const [md, open, close] = mark === 'strong' ? ['**', '<strong>', '</strong>'] : ['*', '<em>', '</em>']
      // ** and * work between word characters or white space; otherwise the element does.
      const safe = (/^\w/.test(text) && /\w$/.test(text)) || (/^[\s(]?$/.test(next[seg.start - 1] ?? '') && /^[\s).,;:!?]?$/.test(next[seg.end] ?? ''))
      next = splice(next, seg.start, seg.end, safe ? `${md}${text}${md}` : `${open}${text}${close}`)
    }
  } else {
    for (const seg of segments) {
      const parent = seg.run.ancestors[0]
      if (colorSpan(parent) && parent.children.length === 1 && seg.whole) {
        const inner = span(seg.run.node)
        next = color ? setAttribute(next, parent, 'style', `color: ${color}`) : splice(next, span(parent).start, span(parent).end, next.slice(inner.start, inner.end))
      } else if (color) {
        next = splice(next, seg.start, seg.end, `<span style="color: ${color}">${next.slice(seg.start, seg.end)}</span>`)
      }
    }
  }
  if (next === source) return { source, unchanged: true }
  if (!sameShape(slides, parse(next))) throw new EditError('the editor could not style these words without changing the slide; edit the Markdown instead (Enter)')
  return { source: next, rerender: true }
}

// --- slides ---------------------------------------------------------------------------

// A slide's text in the file: from its heading to the next slide, or its <Slide> element.
function slideSpan(source, slides, index, { imports = true } = {}) {
  const slide = findSlide(slides, index)
  const start = slide.heading ? span(slide.heading).start : span(slide.node).start
  const next = slides[index + 1]
  let end = !slide.heading ? span(slide.node).end : next ? (next.heading ? span(next.heading) : span(next.node)).start : source.length
  while (end > start && /\s/.test(source[end - 1])) end--
  if (imports && slides.imports.some((n) => span(n).start >= start && span(n).start < end)) throw new EditError(`slide ${index + 1} holds an import; move the import to the top of slides.mdx first`)
  return { slide, start, end }
}

function duplicateSlide(source, index) {
  const slides = parse(source)
  const { slide, start, end } = slideSpan(source, slides, index)
  let text = source.slice(start, end)
  // A copy of the title slide would be a divider (only the first # is the title): keep its kind.
  if (slide.heading?.depth === 1 && slide.implied === 'title' && !readHeading(source, slide).kind) text = text.replace(/^#[ \t]+/, (hashes) => `${hashes}[title] `)
  const next = splice(source, end, end, `\n\n${text}`)
  if (parse(next).length !== slides.length + 1) throw new EditError('the copy did not become a slide of its own; copy it in slides.mdx')
  return { source: next, reload: true, slide: index + 1 }
}

function removeSlide(source, index) {
  const slides = parse(source)
  if (slides.length < 2) throw new EditError('a deck keeps at least one slide')
  const { start, end } = slideSpan(source, slides, index)
  const before = source.slice(0, start).replace(/\s+$/, '')
  const after = source.slice(end).replace(/^\s+/, '')
  const next = after ? `${before}\n\n${after}` : `${before}\n`
  if (parse(next).length !== slides.length - 1) throw new EditError('the slide could not be deleted on its own; delete it in slides.mdx')
  return { source: next, reload: true, slide: Math.min(index, slides.length - 2) }
}

// One edit, or a batch of them applied in order as one step:
//   { type: 'style', id, set }            { type: 'inner', id, selector, set }
//   { type: 'text', id, text }            { type: 'insert', after: id, text }
//   { type: 'delete', id }                { type: 'duplicate', id }
//   { type: 'words', id, plain, start, end, color | mark }   words selected on the page
//   { type: 'duplicate-slide', slide }    { type: 'delete-slide', slide }
//   { type: 'batch', edits: [...] }
// A change of CSS also returns `inverse`, the edit that undoes it (for a batch, a batch).
export function applyEdit(source, edit) {
  switch (edit?.type) {
    case 'style': return editStyle(source, edit.id, edit.set ?? {})
    case 'inner': return editInner(source, edit.id, edit.selector, edit.set ?? {})
    case 'text': return editText(source, edit.id, String(edit.text ?? ''))
    case 'delete': return removeBlock(source, edit.id)
    case 'insert': return insertBlock(source, edit.after, edit.text)
    case 'duplicate': return duplicateBlock(source, edit.id)
    case 'words': return formatWords(source, edit.id, edit)
    case 'duplicate-slide': return duplicateSlide(source, edit.slide)
    case 'delete-slide': return removeSlide(source, edit.slide)
    case 'batch': {
      if (!Array.isArray(edit.edits) || !edit.edits.length) throw new EditError('an empty batch')
      let text = source
      let reload = false
      const inverses = []
      let result = {}
      for (const one of edit.edits) {
        if (one?.type === 'batch') throw new EditError('a batch inside a batch')
        result = applyEdit(text, one)
        text = result.source
        reload ||= result.reload
        if (result.inverse) inverses.unshift(result.inverse)
      }
      const cssOnly = inverses.length === edit.edits.length
      return { ...result, source: text, reload, inverse: cssOnly ? { type: 'batch', edits: inverses } : undefined, unchanged: text === source }
    }
    default: throw new EditError(`unknown edit "${edit?.type}"`)
  }
}
