import assert from 'node:assert/strict'
import test from 'node:test'
import remarkSlideHeadings, { slidesFromHeadings } from './slide-headings.js'

const text = (value) => ({ type: 'text', value })
const heading = (depth, value) => ({ type: 'heading', depth, children: [text(value)] })
const paragraph = (value) => ({ type: 'paragraph', children: [text(value)] })
const attrs = (node) => Object.fromEntries(node.attributes.map((a) => [a.name, a.value]))
const slides = (tree) => tree.children.filter((n) => n.name === 'Slide')

test('# is the title slide, then dividers; ## starts a text slide', () => {
  const tree = { type: 'root', children: [heading(1, 'Talk'), paragraph('Byline'), heading(2, 'A slide'), paragraph('Body'), heading(1, 'Part two')] }
  slidesFromHeadings(tree)
  assert.deepEqual(slides(tree).map((s) => attrs(s).kind), ['title', 'text', 'divider'])
  const [title, body] = slides(tree)[1].children
  assert.equal(title.attributes[0].value, 'title') // the heading goes to the title slot
  assert.equal(title.children[0].value, 'A slide')
  assert.equal(body.children[0].value, 'Body')
})

test('a [kind key=value] tag sets the kind and settings, and leaves the title text', () => {
  const tree = { type: 'root', children: [heading(2, '[demo zoom=1.5 svgMax=390px] The Step')] }
  slidesFromHeadings(tree)
  const [slide] = slides(tree)
  assert.deepEqual(attrs(slide), { kind: 'demo', label: 'The Step', zoom: '1.5', svgMax: '390px' })
  assert.equal(slide.children[0].children[0].value, 'The Step')
})

test('imports stay at the top, a hand-written <Slide> passes through, and Slide/Notes are imported once', () => {
  const esm = { type: 'mdxjsEsm', value: "import Fig from './Fig.svelte'" }
  const manual = { type: 'mdxJsxFlowElement', name: 'Slide', attributes: [], children: [] }
  const tree = { type: 'root', children: [esm, heading(2, 'A'), manual, heading(2, 'B')] }
  slidesFromHeadings(tree)
  assert.deepEqual(tree.children.filter((n) => n.type === 'mdxjsEsm').map((n) => n.value),
    ["import Slide from '@bloggie/components/slides/Slide.astro'", "import Notes from '@bloggie/components/slides/Notes.astro'", "import Fig from './Fig.svelte'"])
  assert.equal(slides(tree).length, 3)
  assert.equal(slides(tree)[1], manual)
})

test('only files named slides.mdx are transformed', () => {
  const run = (path) => {
    const tree = { type: 'root', children: [heading(2, 'A')] }
    remarkSlideHeadings()(tree, { path })
    return tree.children[0].type
  }
  assert.equal(run('/posts/x/index.mdx'), 'heading')
  assert.notEqual(run('/posts/x/slides.mdx'), 'heading')
})
