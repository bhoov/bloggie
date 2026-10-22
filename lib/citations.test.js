import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReferences, toBibTeX } from './citations.js'

// Sample entries, so the tests do not depend on which sources a blog cites (a new blog cites only the example's).
const catalog = {
  paper: { type: 'paper', title: 'A paper', authors: ['A. Author'], year: 2025, url: 'https://example.org/paper' },
  data: { type: 'artifact', title: 'A dataset', authors: ['B. Author'], year: 2025, url: 'https://example.org/data' },
}
const base = 'https://example.org/blog/posts/some-post/'

test('bad keys, incomplete entries, and executable URLs fail before rendering', () => {
  for (const key of ['missing', '__proto__', 'bad key']) {
    assert.throws(() => resolveReferences(catalog, [key], base), /Unknown citation/)
  }
  assert.throws(() => resolveReferences({ bad: { title: 'Missing fields' } }, ['bad'], base), /Incomplete/)
  assert.throws(() => resolveReferences({ bad: { ...catalog.paper, url: 'javascript:alert(1)' } }, ['bad'], base), /Unsupported/)
})

test('BibTeX includes paper and versioned artifact metadata and escapes text', () => {
  const refs = resolveReferences({
    paper: catalog.paper,
    artifact: { ...catalog.data, title: 'A & B {data}', version: 'v1_2' },
  }, ['paper', 'artifact'], base)
  const bib = toBibTeX(refs)
  assert.equal((bib.match(/@misc\{/g) ?? []).length, 2)
  assert.ok(bib.includes('A \\& B \\{data\\}'))
  assert.ok(bib.includes('version = {v1\\_2}'))
  assert.ok(bib.includes(catalog.data.url))
})
