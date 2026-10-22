// The slide editor's way to show a change of the deck without a reload (client.js). The dev server
// has written slides.mdx; the page fetches the server's new render of itself and swaps in only what
// changed. The deck's outline before and after the edit (source.js: a hash of each slide and of each
// block) says what that is: a slide whose tag or title changed is drawn again whole; otherwise only
// its changed, new and removed blocks are. Every other element stays as it is, so a figure on another
// slide, or another block of the same slide, keeps running: an Astro island that is moved in the page
// starts its figure again, so a kept block is never moved; new blocks go in around it.

const STATE = ['active', 'before', 'after']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The server's render of this page once it is the one of `version` (the page's <template
// data-edit-version>): the dev server sees the written file a moment after the write.
export async function fetchRender(version, timeout = 8000) {
  const end = Date.now() + timeout
  for (;;) {
    const res = await fetch(location.pathname + location.search, { cache: 'no-store' })
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
    if (doc.querySelector('template[data-edit-version]')?.dataset.editVersion === version) return doc
    if (Date.now() > end) throw new Error('the dev server did not render the change in time')
    await sleep(120)
  }
}

// Give each figure's id (on the <template> before it) to its element, as the editor does at start.
export function resolveMarkers(root) {
  root.querySelectorAll('template[data-edit]').forEach((marker) => {
    let el = marker.nextElementSibling
    while (el && /^(STYLE|SCRIPT|TEMPLATE)$/.test(el.tagName)) el = el.nextElementSibling
    if (el && !el.dataset.edit) el.dataset.edit = marker.dataset.edit
    marker.remove()
  })
}

// Pair two lists of hashes in order: the longest run of equal ones is kept, and what is left between
// them is changed (one for one), inserted or removed. The live update uses it too (bloggie/live/client.js).
export function align(a, b) {
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const ops = []
  let i = 0
  let j = 0
  const gap = (ai, bj) => {
    // between two kept items: change as many as both sides have, then insert or remove the rest
    const k = Math.min(ai.length, bj.length)
    for (let t = 0; t < k; t++) ops.push({ op: 'change', a: ai[t], b: bj[t] })
    for (let t = k; t < ai.length; t++) ops.push({ op: 'remove', a: ai[t] })
    for (let t = k; t < bj.length; t++) ops.push({ op: 'insert', b: bj[t] })
  }
  let ai = []
  let bj = []
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      gap(ai, bj)
      ai = []
      bj = []
      ops.push({ op: 'keep', a: i++, b: j++ })
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) bj.push(j++)
    else ai.push(i++)
  }
  gap(ai, bj)
  return ops
}

// A slide-box id in the new render may already be another element's in this page (the build numbers
// them in order): give the new ones ids of their own, and their rules with them.
let unique = 0
function ownIds(root) {
  for (const el of root.querySelectorAll('[id^="slide-box-"]')) {
    const old = el.id
    const id = `slide-box-e${++unique}`
    el.id = id
    for (const style of root.querySelectorAll(`style[data-box="${old}"]`)) {
      style.dataset.box = id
      style.textContent = style.textContent.replace(new RegExp(`#${old}(?![\\w-])`, 'g'), `#${id}`)
    }
  }
}

// A figure on a new slide needs its island directive's script, which a page runs once: run any of the
// new render's inline scripts this page has not run.
function ensureScripts(root) {
  const known = new Set([...document.scripts].map((s) => s.textContent))
  for (const script of root.querySelectorAll('script:not([src])')) {
    if (known.has(script.textContent) || (script.type && script.type !== 'text/javascript')) continue
    const copy = document.createElement('script')
    copy.textContent = script.textContent
    document.head.append(copy)
    known.add(script.textContent)
  }
}

const imported = (node) => document.importNode(node, true)
// A block and the <style data-box> of its inner rules, which comes right before it.
const styleOf = (el) => (el.id && el.previousElementSibling?.matches(`style[data-box="${el.id}"]`) ? el.previousElementSibling : null)
const withStyle = (el) => [styleOf(el), el].filter(Boolean)
const remove = (el) => withStyle(el).forEach((n) => n.remove())

// The attributes of a slide from the new render; its place in the deck (active, before, after,
// aria-hidden, inert) stays the page's.
function syncAttributes(live, fresh) {
  const state = STATE.filter((c) => live.classList.contains(c))
  for (const { name } of [...live.attributes]) if (!fresh.hasAttribute(name) && !['aria-hidden', 'inert'].includes(name)) live.removeAttribute(name)
  for (const { name, value } of [...fresh.attributes]) if (!['aria-hidden', 'inert'].includes(name)) live.setAttribute(name, value)
  live.classList.add(...state)
}

function replaceSlide(live, fresh) {
  syncAttributes(live, fresh)
  live.replaceChildren(...[...fresh.childNodes].map(imported))
}

// The element of `live` at the place `el` has in `fresh`: the same steps down from the slide.
function samePlace(el, fresh, live) {
  const steps = []
  for (let n = el; n && n !== fresh; n = n.parentElement) steps.unshift([...n.parentElement.children].indexOf(n))
  let at = live
  for (const k of steps) at = at?.children[k]
  return at ?? null
}

// Draw a changed slide: its title and its changed, new and removed blocks from the new render. `ids`
// gets the old id → new id of each element kept.
function patchSlide(live, fresh, was, is, a, b, ids) {
  if (was.head !== is.head || was.opaque !== is.opaque || was.kind !== is.kind) return replaceSlide(live, fresh)
  const freshBlock = (id) => fresh.querySelector(`[data-edit="${id}"]`)
  // The page's elements, found by their ids before any id changes.
  const oldTitle = live.querySelector(`[data-edit="${a}/t"]`)
  const oldBlocks = was.blocks.map((id) => live.querySelector(`[data-edit="${id}"]`))
  if (oldBlocks.some((el) => !el)) return replaceSlide(live, fresh)
  if (was.title === is.title) {
    if (oldTitle) { oldTitle.dataset.edit = `${b}/t`; ids.set(`${a}/t`, `${b}/t`) }
  } else {
    const newTitle = freshBlock(`${b}/t`)
    if (!oldTitle !== !newTitle) return replaceSlide(live, fresh)
    if (oldTitle) oldTitle.replaceWith(imported(newTitle))
  }
  syncAttributes(live, fresh)
  const inserts = []
  for (const { op, a: i, b: j } of align(was.hashes, is.hashes)) {
    if (op === 'keep') {
      oldBlocks[i].dataset.edit = is.blocks[j]
      ids.set(was.blocks[i], is.blocks[j])
    } else if (op === 'remove') remove(oldBlocks[i])
    else if (op === 'change') {
      const next = freshBlock(is.blocks[j])
      if (!next) return replaceSlide(live, fresh)
      oldBlocks[i].before(...withStyle(next).map(imported))
      remove(oldBlocks[i])
    } else inserts.push(freshBlock(is.blocks[j]))
  }
  for (const next of inserts) {
    const container = next && samePlace(next.parentElement, fresh, live)
    if (!container) return replaceSlide(live, fresh)
    // Before the first block after it that the page has, in the same element; else at the end.
    let before = null
    for (let n = next.nextElementSibling; n && !before; n = n.nextElementSibling) {
      const there = n.dataset?.edit && live.querySelector(`[data-edit="${n.dataset.edit}"]`)
      if (there?.parentElement === container) before = styleOf(there) ?? there
    }
    for (const node of withStyle(next).map(imported)) container.insertBefore(node, before)
  }
}

// Number a kept slide's elements for its new place in the deck.
function renumber(slide, to, ids) {
  slide.dataset.editSlide = String(to)
  for (const el of slide.querySelectorAll('[data-edit]')) {
    const next = `${to}/${el.dataset.edit.split('/')[1]}`
    ids.set(el.dataset.edit, next)
    el.dataset.edit = next
  }
}

// Swap the new render's changes into the deck. Returns each kept element's old id → new id, the new
// indexes of the slides drawn again, and whether the number of slides changed.
export function reconcile(deck, was, is, doc) {
  const freshDeck = doc.querySelector('.deck')
  if (!freshDeck) throw new Error('the new render has no deck')
  resolveMarkers(freshDeck)
  ownIds(freshDeck)
  ensureScripts(freshDeck)
  const live = [...deck.querySelectorAll(':scope > section.slide')]
  const fresh = [...freshDeck.querySelectorAll(':scope > section.slide')]
  if (live.length !== was.slides.length || fresh.length !== is.slides.length) throw new Error('the page and the outline do not match')
  const ids = new Map()
  const drawn = []
  let previous = null
  for (const { op, a, b } of align(was.slides.map((s) => s.hash), is.slides.map((s) => s.hash))) {
    if (op === 'keep') {
      renumber(live[a], b, ids)
      previous = live[a]
    } else if (op === 'change') {
      patchSlide(live[a], fresh[b], was.slides[a], is.slides[b], a, b, ids)
      live[a].dataset.editSlide = String(b)
      drawn.push(b)
      previous = live[a]
    } else if (op === 'insert') {
      const slide = imported(fresh[b])
      STATE.forEach((c) => slide.classList.remove(c))
      slide.classList.add('after')
      slide.setAttribute('aria-hidden', 'true')
      slide.inert = true
      const first = deck.querySelector(':scope > section.slide')
      if (previous) previous.after(slide)
      else if (first) first.before(slide)
      else deck.append(slide)
      drawn.push(b)
      previous = slide
    } else live[a].remove()
  }
  return { ids, drawn, recount: was.slides.length !== is.slides.length }
}
