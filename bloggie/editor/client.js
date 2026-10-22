// The slide editor: change a deck with the mouse and keyboard under `npm run dev`, and write each
// change into its slides.mdx. Slides.astro loads this file only when import.meta.env.DEV is set,
// so a built deck has no trace of it. The keys follow Figma's where they can.
//
//   E, or Edit in the deck's nav   turn editing on; Esc with nothing selected turns it off
//   click, Shift+click, drag       select a block (the title, a paragraph, a list, an equation, code,
//                                  a figure, a demo note), add one to the selection, draw a box
//                                  around several on the slide's background
//   ⌘+click, double-click a figure select an element inside a block, such as a figure's label;
//                                  Esc (or Shift+Enter) goes back out to the block
//   Option+click                   use the figure under the pointer as a reader does
//   drag                           move; it snaps to where it started and to the stage's center
//                                  lines (hold ⌘ to place it freely)
//   side / corner handle           width; text size and width together
//   ←↑→↓, Shift+←↑→↓               move 1 px, 10 px
//   ⌘B, ⌘I, ⌘⇧> ⌘⇧<                bold, italic, larger, smaller text
//   ⌥⌘L ⌥⌘T ⌥⌘R                    text left, center, right
//   ⌥A ⌥H ⌥D, ⌥W ⌥V ⌥S             align left, centers, right, top, middles, bottom: several blocks to
//                                  each other, one block to the slide
//   ⌘] ⌘[, ⌥⌘] ⌥⌘[                 forward, backward; to the front, to the back
//   double-click text              select words on the slide: then B, I and the colors style
//                                  just those words (in slides.mdx: **, *, <span style="color: …">)
//   Enter                          edit the block's Markdown in place; there ⌘B and ⌘I wrap the
//                                  selected words in ** and *, ⌘Enter (or a click away) saves
//   color, eyedropper              the palette (theme colors, and the last 10 taken with the
//                                  eyedropper, with an opacity slider), or a color taken from
//                                  anywhere on the screen
//   font, size                     the font menu (the theme's sans, serif and mono) and the size in px
//   ⌘D, Delete, ⌘A                 duplicate, delete, select every block of the slide
//   Tab, Shift+Tab                 next, previous block
//   ⌘Z, ⌘⇧Z                        undo, redo (the dev server keeps the steps, across reloads)
//
// The column on the left shows every slide (panel.js): click one to show it; there ⌘D duplicates
// the slide and Delete deletes it, as do the buttons at its top for the slide on the stage.
//
// A change of CSS is sent to the dev server (integration.js), which writes it to slides.mdx; the
// page shows it already. A change of text, or of the blocks or slides, the page draws from the
// server's new render (patch.js), in place: only what changed is swapped in, and nothing reloads.
// Words styled on the slide show their new style at once, until that render replaces the block.
// With nothing selected, the deck's own keys work as usual.
import './editor.css'
import { parseRules, scopeRules } from './css.js'
import { createPanel, stillCopy } from './panel.js'
import { fetchRender, reconcile } from './patch.js'
import { hex, pickColor } from './eyedropper.js'

const STAGE = { width: 1600, height: 900 }
const PROTOCOL = 3 // integration.js's: the dev server's half must be as new as this file
const ENDPOINT = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}__slide-editor`
const MANAGED = ['translate', 'width', 'max-width', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'color', 'fill', 'z-index', 'position', 'display']
const COLORS = [
  ['Default color', null],
  ['Primary ink', 'var(--text-primary)'],
  ['Secondary ink', 'var(--text-secondary)'],
  ['Muted ink', 'var(--text-muted)'],
  ['Blue (series 1)', 'var(--series-1)'],
  ['Orange (series 2)', 'var(--series-2)'],
  ['Green (series 3)', 'var(--series-3)'],
]
// The font menu: the theme's fonts, by name, so that a slide follows the theme.
const FONTS = [['Sans', 'var(--sans)'], ['Serif', 'var(--serif)'], ['Mono', 'var(--mono)']]
const HANDLES = ['nw', 'ne', 'sw', 'se', 'w', 'e']
const SNAP = 10 // stage px within which a moved block snaps to a guide
const COMMIT_DELAY = 450 // ms of quiet before a run of nudges or size steps is written
const SVG = 'http://www.w3.org/2000/svg'
// Classes that name a state rather than a part, which a selector for an element inside a block
// leaves out: they come and go as the figure runs.
const STATE_CLASS = /^(svelte-|astro-|se-|is-|has-)|^(active|on|off|shown|hidden|selected|current|playing|paused|disabled|open|done|before|after|step)$/

const TOKENS = ['--text-primary', '--text-secondary', '--text-muted', '--series-1', '--series-2', '--series-3', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--axis', '--grid'] // an eyedropped color that is one of these is written as it
const RECENT_KEY = 'slide-editor:colors'
const RECENT = 10

const KEYS = [
  ['E, Esc', 'edit on; off (with nothing selected)'],
  ['click, Shift+click', 'select, add to the selection'],
  ['drag the background', 'select the blocks in a box'],
  ['⌘+click, double-click', 'an element inside a block or figure'],
  ['Option+click', 'use the figure as a reader does'],
  ['drag (⌘: free)', 'move, snapping to guides'],
  ['side / corner handle', 'width / scale'],
  ['← ↑ → ↓ (Shift)', 'move 1 px (10 px)'],
  ['⌘B, ⌘I, ⌘⇧> ⌘⇧<', 'bold, italic, text size'],
  ['⌥⌘L ⌥⌘T ⌥⌘R', 'text left, center, right'],
  ['⌥A ⌥H ⌥D', 'align left, centers, right'],
  ['⌥W ⌥V ⌥S', 'align top, middles, bottom'],
  ['⌘] ⌘[ (⌥: all the way)', 'forward, backward'],
  ['double-click text', 'select words to style'],
  ['Enter', 'edit the Markdown'],
  ['⌘D, Delete, ⌘A', 'duplicate, delete, select all'],
  ['Tab, Shift+Tab', 'next, previous block'],
  ['⌘Z, ⌘⇧Z', 'undo, redo'],
]

const round = (n) => Math.round(n)
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const html = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const icon = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`

export function initEditor(deck) {
  const file = deck?.dataset.editFile
  if (!file || document.body.classList.contains('presenter-mode')) return

  // --- state kept across reloads (a change of text reloads the page) ---------------------------
  const storeKey = `slide-editor:${location.pathname}`
  const stored = () => { try { return JSON.parse(sessionStorage.getItem(storeKey)) ?? {} } catch { return {} } }
  const store = (patch) => { try { sessionStorage.setItem(storeKey, JSON.stringify({ ...stored(), ...patch })) } catch {} }

  let on = false
  let version = null
  let selection = [] // the selected blocks; the last is the one the toolbar shows
  let inner = null // { block, el, selector }: an element inside a block
  let hovered = null
  let dragging = false
  let passing = false // an Option+click, which goes to the figure under the pointer
  let editor = null // the open Markdown editor: { panel, area, id, singleLine, original }
  let words = null // the block whose words are being selected (double-click on text)
  let known = null // the deck's outline as the page shows it (source.js), for patch.js
  let picking = false // the eyedropper is open: it has the pointer and the keys
  let history = { undo: 0, redo: 0 }
  const primary = () => selection.at(-1) ?? null

  // A figure tag's id is on a <template> before it (bloggie/lib/slide-headings.js); give it to the
  // figure's first element, after the island's inline <style> and <script>.
  deck.querySelectorAll('template[data-edit]').forEach((marker) => {
    let el = marker.nextElementSibling
    while (el && /^(STYLE|SCRIPT|TEMPLATE)$/.test(el.tagName)) el = el.nextElementSibling
    if (el && !el.dataset.edit) el.dataset.edit = marker.dataset.edit
    marker.remove()
  })

  const slideList = () => [...deck.querySelectorAll(':scope > section.slide')]
  const activeSlide = () => deck.querySelector(':scope > section.slide.active')
  const activeIndex = () => slideList().indexOf(activeSlide())
  const byId = (id) => deck.querySelector(`[data-edit="${id}"]`)
  const isTitle = (el) => el?.dataset.edit.endsWith('/t')
  const slideOf = (el) => Number(el.dataset.edit.split('/')[0])
  const blockIndex = (el) => (isTitle(el) ? -1 : Number(el.dataset.edit.split('/')[1]))
  const blocksOf = (slide) => [...(slide?.querySelectorAll('[data-edit]') ?? [])]
  const blockAt = (target) => {
    const block = target instanceof Element ? target.closest('[data-edit]') : null
    return block && activeSlide()?.contains(block) ? block : null
  }
  // The block under a point, and the element in it: the topmost of the slide's blocks there, even
  // one that paints below the element on top (a block sent backward, under its slide's body).
  const under = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('.se-layer, .se-toolbar, .se-panel, .se-source')) return {}
      const block = blockAt(el)
      if (block) return { block, target: el }
    }
    return {}
  }
  const isSvg = (el) => el.namespaceURI === SVG && el.localName !== 'svg'

  // --- geometry ------------------------------------------------------------------------------
  const stageScale = () => deck.getBoundingClientRect().width / STAGE.width
  function union(rects) {
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top)
  }
  // A figure's island is display: contents and has no box of its own: use its children's.
  function rectOf(el) {
    if (getComputedStyle(el).display !== 'contents') return el.getBoundingClientRect()
    const rects = [...el.children].map(rectOf).filter((r) => r.width || r.height)
    return rects.length ? union(rects) : el.getBoundingClientRect()
  }
  // An element's translate: inline for a block, from the stylesheet for an element inside one.
  const readTranslate = (el) => {
    const value = el.style.translate || getComputedStyle(el).translate
    const [x = '0', y = '0'] = !value || value === 'none' ? [] : value.split(/\s+/)
    return [parseFloat(x) || 0, parseFloat(y) || 0]
  }
  const translateValue = (x, y) => (round(x) || round(y) ? `${round(x)}px ${round(y)}px` : null)
  // Screen px per CSS px of this element's own lengths: the stage scale times any CSS zoom above it
  // (a demo's figure area is zoomed). Measured, so it holds for any transform.
  function unitOf(el) {
    const before = el.style.translate
    const [x, y] = readTranslate(el)
    const a = rectOf(el).left
    el.style.translate = `${x + 100}px ${y}px`
    const b = rectOf(el).left
    el.style.translate = before
    return (b - a) / 100 || stageScale()
  }
  // The slide's content box, inside its padding: what one block aligns to.
  function contentBox(slide) {
    const r = slide.getBoundingClientRect()
    const cs = getComputedStyle(slide)
    const s = stageScale()
    const [t, rt, b, l] = ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(cs[`padding${side}`]) * s)
    return new DOMRect(r.left + l, r.top + t, r.width - l - rt, r.height - t - b)
  }

  // --- the dev server ------------------------------------------------------------------------
  let queue = Promise.resolve()
  function send(action, payload = {}) {
    const run = async () => {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, file, version, ...payload }) })
      const data = await res.json().catch(() => ({ error: `the dev server answered HTTP ${res.status}` }))
      if (data.version) version = data.version
      if ('undo' in data) history = { undo: data.undo, redo: data.redo }
      if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { data })
      if (data.outline) {
        const before = known
        known = data.outline
        if (data.rerender && before) await redraw(before, known, data)
      }
      return data
    }
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }

  // Draw a change of the deck from the server's new render, in place (patch.js); `data.ids` gets the
  // old id → new id of each block kept. If the page cannot be brought to match slides.mdx this way,
  // it reloads, and shows the file as it is.
  async function redraw(before, after, data) {
    setStatus('Drawing…', 'busy')
    const shown = activeSlide()
    const keep = selection.map((el) => el.dataset.edit)
    try {
      const doc = await fetchRender(after.render)
      const { ids, drawn, recount } = reconcile(deck, before, after, doc)
      data.ids = ids
      // The rules of elements inside blocks, for the blocks kept, under their new ids.
      const rules = [...rulesOf].filter(([id]) => ids.has(id)).map(([id, r]) => [ids.get(id), r])
      rulesOf.clear()
      loading.clear()
      for (const [id, r] of rules) { rulesOf.set(id, r); loading.set(id, Promise.resolve()) }
      renderLive()
      if (recount) {
        const index = Number.isInteger(data.slide) ? data.slide : Math.max(0, slideList().indexOf(shown))
        deck.dispatchEvent(new CustomEvent('deck:slides', { detail: { index } }))
        rebuildPanel()
      } else drawn.forEach((i) => panel.refresh(i))
      const problem = mismatch(after)
      if (problem) throw new Error(problem)
    } catch (error) {
      console.warn('slide editor: the page reloads, because', error)
      store({ on: true, select: keep, goto: Number.isInteger(data.slide) ? data.slide : null })
      location.reload()
      await new Promise(() => {}) // the page is going
    }
  }

  function failed(error) {
    if (error.data?.reload) {
      store({ on: true })
      setStatus(error.message, 'error')
      setTimeout(() => location.reload(), 1200)
      return
    }
    setStatus(`Not saved: ${error.message}`, 'error')
  }

  // --- CSS of elements inside blocks: the Box's inner rules, shown live ---------------------------
  // The page's own <style data-box> for a block (bloggie/lib/slide-headings.js) stays until the editor
  // loads the block's rules; from then on one live stylesheet draws them, with the same weight (an id).
  const rulesOf = new Map() // block id -> [[selector, [[property, value]]]]
  const loading = new Map() // block id -> the request for its rules
  const live = document.createElement('style')
  live.dataset.slideEditor = 'inner'
  document.head.append(live)
  function renderLive() {
    live.textContent = [...rulesOf].map(([id, rules]) => scopeRules(rules, `:is(#se-live, [data-edit="${id}"])`)).join('\n')
    for (const id of rulesOf.keys()) {
      const el = byId(id)
      const own = el?.id && document.querySelector(`style[data-box="${el.id}"]`)
      if (own) own.media = 'not all'
    }
  }
  function loadRules(block) {
    const id = block.dataset.edit
    if (!loading.has(id)) {
      loading.set(id, send('read', { id }).then((data) => {
        rulesOf.set(id, parseRules(data.inner))
        renderLive()
      }, (error) => { loading.delete(id); throw error }))
    }
    return loading.get(id)
  }
  function applyInner(id, selector, set) {
    const rules = rulesOf.get(id) ?? []
    let rule = rules.find(([s]) => s === selector)
    if (!rule) rules.push((rule = [selector, []]))
    for (const [property, value] of Object.entries(set)) {
      const at = rule[1].findIndex(([p]) => p === property)
      if (value == null) { if (at >= 0) rule[1].splice(at, 1) }
      else if (at >= 0) rule[1][at][1] = value
      else rule[1].push([property, value])
    }
    rulesOf.set(id, rules)
    renderLive()
  }
  const innerValue = (id, selector, property) => rulesOf.get(id)?.find(([s]) => s === selector)?.[1].find(([p]) => p === property)?.[1] ?? null

  // A selector for `el` that starts at a child of the block's element: each step names the tag, one
  // class that names a part, and the position among like siblings where that is needed. A figure's
  // island gets a <div class="slide-box"> around it, so its selector starts at the island.
  function selectorFor(block, el) {
    const path = (withClass) => {
      const out = []
      for (let n = el; n && n !== block; n = n.parentElement) {
        const cls = withClass ? [...n.classList].find((c) => !STATE_CLASS.test(c)) : null
        const like = [...n.parentElement.children].filter((s) => s.localName === n.localName)
        let step = cls ? `${n.localName}.${CSS.escape(cls)}` : n.localName
        if (like.filter((s) => !cls || s.classList.contains(cls)).length > 1) step += `:nth-of-type(${like.indexOf(n) + 1})`
        out.unshift(step)
      }
      return out
    }
    let steps = path(true)
    if (block.querySelectorAll(`:scope > ${steps.join(' > ')}`).length !== 1) steps = path(false)
    return (block.localName === 'astro-island' ? ['astro-island', ...steps] : steps).join(' > ')
  }

  // --- CSS changes: shown at once, written after a short pause ---------------------------------
  const pending = new Map() // key -> { edit, before, undo() }
  let commitTimer = null

  function applyStyle(el, set) {
    for (const [property, value] of Object.entries(set)) {
      if (value == null) el.style.removeProperty(property)
      else el.style.setProperty(property, value)
    }
  }

  function schedule(now) {
    renderToolbar()
    clearTimeout(commitTimer)
    if (now) flush()
    else commitTimer = setTimeout(flush, COMMIT_DELAY)
  }

  // A block's own CSS (its Box's style, or an element's style attribute).
  function stage(el, set, { now = false } = {}) {
    const key = `style ${el.dataset.edit}`
    const entry = pending.get(key) ?? { edit: { type: 'style', id: el.dataset.edit, set: {} }, before: {} }
    for (const property of Object.keys(set)) if (!(property in entry.before)) entry.before[property] = el.style.getPropertyValue(property) || null
    Object.assign(entry.edit.set, set)
    entry.undo = () => applyStyle(el, entry.before)
    pending.set(key, entry)
    applyStyle(el, set)
    schedule(now)
  }

  // CSS for an element inside a block (the block's Box's inner rules), once the block's rules are here.
  function stageInner(block, selector, set, { now = false } = {}) {
    const id = block.dataset.edit
    if (!rulesOf.has(id)) return loadRules(block).then(() => stageInner(block, selector, set, { now }), failed)
    const key = `inner ${id} ${selector}`
    const entry = pending.get(key) ?? { edit: { type: 'inner', id, selector, set: {} }, before: {} }
    for (const property of Object.keys(set)) if (!(property in entry.before)) entry.before[property] = innerValue(id, selector, property)
    Object.assign(entry.edit.set, set)
    entry.undo = () => applyInner(id, selector, entry.before)
    pending.set(key, entry)
    applyInner(id, selector, set)
    schedule(now)
  }

  // Everything waiting goes in one request: one step to undo.
  function flush() {
    clearTimeout(commitTimer)
    if (!pending.size) return
    const entries = [...pending.values()]
    pending.clear()
    const edit = entries.length === 1 ? entries[0].edit : { type: 'batch', edits: entries.map((e) => e.edit) }
    setStatus('Saving…', 'busy')
    const chosen = selection.map((el) => el.dataset.edit)
    send('edit', { edit }).then((data) => {
      setStatus('Saved', 'ok')
      // A figure's first style wraps it in a new element, which the page drew again.
      if (data.rerender) select(chosen.map((id) => byId(data.ids?.get(id) ?? id)))
      renderToolbar()
      refreshThumb()
    }, (error) => {
      entries.forEach((e) => e.undo()) // the file does not have it, so neither does the page
      renderToolbar()
      failed(error)
    })
  }

  // The page is about to go (a reload, or the deck is left): write what is still waiting.
  window.addEventListener('pagehide', () => {
    clearTimeout(commitTimer)
    if (!pending.size) return
    const edits = [...pending.values()].map((e) => e.edit)
    pending.clear()
    const body = JSON.stringify({ action: 'edit', file, version, edit: edits.length === 1 ? edits[0] : { type: 'batch', edits } })
    fetch(ENDPOINT, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
  })

  // --- the chrome: nav button, toolbar, slide list, selection layer -------------------------------
  const nav = document.querySelector('.deck-nav')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'deck-text se-toggle'
  toggle.textContent = 'Edit'
  toggle.title = 'Edit this deck with the mouse and keyboard; changes go to slides.mdx (E)'
  nav?.insertBefore(toggle, nav.querySelector('[data-deck="notes"]'))
  toggle.addEventListener('click', () => (on ? turnOff() : turnOn()))

  const lines = (rows) => icon(rows.map(([x1, x2], i) => `<line x1="${x1}" x2="${x2}" y1="${3 + i * 3.3}" y2="${3 + i * 3.3}" />`).join(''))
  const toolbar = document.createElement('div')
  toolbar.className = 'se-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Slide editor')
  toolbar.innerHTML = `
    <span class="se-file" title="${html(file)}">Editing <b>slides.mdx</b></span>
    <span class="se-what"></span>
    <span class="se-group se-needs-block">
      <select class="se-font" aria-label="Font" title="Font"><option value="">Default</option>${FONTS.map(([name, value]) => `<option value="${value}">${name}</option>`).join('')}</select>
      <button type="button" data-act="smaller" title="Smaller text (⌘⇧<)">A−</button>
      <input class="se-size" type="number" min="6" max="400" step="1" aria-label="Font size in px" title="Font size in px; Enter sets it" />
      <button type="button" data-act="larger" title="Larger text (⌘⇧>)">A+</button>
    </span>
    <span class="se-group se-needs-block">
      <button type="button" data-act="bold" title="Bold (⌘B)"><b>B</b></button>
      <button type="button" data-act="italic" title="Italic (⌘I)"><i>I</i></button>
    </span>
    <span class="se-group se-needs-block">
      <button type="button" data-act="text-align" data-value="left" title="Text left (⌥⌘L)">${lines([[2, 14], [2, 10], [2, 12], [2, 8]])}</button>
      <button type="button" data-act="text-align" data-value="center" title="Text centered (⌥⌘T)">${lines([[2, 14], [4, 12], [3, 13], [5, 11]])}</button>
      <button type="button" data-act="text-align" data-value="right" title="Text right (⌥⌘R)">${lines([[2, 14], [6, 14], [4, 14], [8, 14]])}</button>
    </span>
    <span class="se-group se-needs-block se-colors">
      <button type="button" data-act="palette" aria-expanded="false" title="Color: of the block, or of the selected words"><span class="se-color-now"></span></button>
      <button type="button" data-act="eyedrop" title="Take a color from anywhere on the screen">${icon('<path d="M11.2 1.8a2 2 0 0 1 2.9 2.9l-1.6 1.6.7.7-1.1 1.1-.7-.7-5.6 5.6H3.6v-2.2l5.6-5.6-.7-.7 1.1-1.1.7.7z" />')}</button>
      <div class="se-palette" hidden>
        <div class="se-swatches">${COLORS.map(([name, value]) => `<button type="button" data-act="color" data-value="${value ?? ''}" title="${name}"><span style="${value ? `background: ${value}` : ''}"></span></button>`).join('')}</div>
        <label class="se-opacity" title="Opacity of the color; a swatch keeps it"><span>Opacity</span><input type="range" min="0" max="100" step="5" value="100" /><output>100%</output></label>
        <div class="se-recent-label">Recent (eyedropper)</div>
        <div class="se-swatches se-recent"></div>
      </div>
    </span>
    <span class="se-group se-needs-block">
      <button type="button" data-act="align" data-value="left" title="Align left (⌥A); one block aligns to the slide">${icon('<line x1="2" x2="2" y1="1" y2="15" /><rect x="4" y="3" width="9" height="4" /><rect x="4" y="9" width="6" height="4" />')}</button>
      <button type="button" data-act="align" data-value="hcenter" title="Align horizontal centers (⌥H)">${icon('<line x1="8" x2="8" y1="1" y2="15" /><rect x="3" y="3" width="10" height="4" /><rect x="5" y="9" width="6" height="4" />')}</button>
      <button type="button" data-act="align" data-value="right" title="Align right (⌥D)">${icon('<line x1="14" x2="14" y1="1" y2="15" /><rect x="3" y="3" width="9" height="4" /><rect x="6" y="9" width="6" height="4" />')}</button>
      <button type="button" data-act="align" data-value="top" title="Align top (⌥W)">${icon('<line x1="1" x2="15" y1="2" y2="2" /><rect x="3" y="4" width="4" height="9" /><rect x="9" y="4" width="4" height="6" />')}</button>
      <button type="button" data-act="align" data-value="vcenter" title="Align vertical centers (⌥V)">${icon('<line x1="1" x2="15" y1="8" y2="8" /><rect x="3" y="3" width="4" height="10" /><rect x="9" y="5" width="4" height="6" />')}</button>
      <button type="button" data-act="align" data-value="bottom" title="Align bottom (⌥S)">${icon('<line x1="1" x2="15" y1="14" y2="14" /><rect x="3" y="3" width="4" height="9" /><rect x="9" y="6" width="4" height="6" />')}</button>
    </span>
    <span class="se-group se-needs-block">
      <button type="button" data-act="layer" data-value="forward" title="Bring forward (⌘]; to the front: ⌥⌘])">${icon('<rect x="1.5" y="1.5" width="8" height="8" class="se-paper" /><rect x="6.5" y="6.5" width="8" height="8" class="se-fill" />')}</button>
      <button type="button" data-act="layer" data-value="backward" title="Send backward (⌘[; to the back: ⌥⌘[)">${icon('<rect x="6.5" y="6.5" width="8" height="8" class="se-fill" /><rect x="1.5" y="1.5" width="8" height="8" class="se-paper" />')}</button>
    </span>
    <span class="se-group">
      <button type="button" data-act="text" class="se-needs-block" title="Edit the Markdown (Enter, or double-click the block)">Edit text</button>
      <button type="button" data-act="add" title="Add a paragraph after the selected block, or at the end of the slide">+ Text</button>
      <button type="button" data-act="reset" class="se-needs-block" title="Remove the position, size, font, color and layer changes">Reset</button>
      <button type="button" data-act="delete" class="se-needs-block" title="Delete the selected blocks (Delete); inside a block, hide the element on the slide">Delete</button>
    </span>
    <span class="se-group">
      <button type="button" data-act="undo" title="Undo (⌘Z)">↶</button>
      <button type="button" data-act="redo" title="Redo (⌘⇧Z)">↷</button>
    </span>
    <span class="se-status" role="status"></span>
    <span class="se-end">
      <button type="button" data-act="help" aria-expanded="false" title="Keys">?</button>
      <button type="button" data-act="done" class="se-done" title="Stop editing (E, or Esc with nothing selected)">Done</button>
    </span>
    <div class="se-help" hidden>${KEYS.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}<p>Every change is written to slides.mdx at once. Undo steps last until the dev server stops.</p></div>`
  document.body.append(toolbar)
  const sizeInput = toolbar.querySelector('.se-size')
  const fontSelect = toolbar.querySelector('.se-font')
  const opacityInput = toolbar.querySelector('.se-opacity input')
  const opacityOut = toolbar.querySelector('.se-opacity output')
  const statusEl = toolbar.querySelector('.se-status')
  const helpEl = toolbar.querySelector('.se-help')
  const button = (act) => toolbar.querySelector(`[data-act="${act}"]`)

  const makePanel = () => createPanel({
    deck,
    slides: slideList(),
    onPick: (i) => { select([]); location.hash = `#${i + 1}` },
    onDuplicate: (i) => slideEdit('duplicate-slide', i),
    onDelete: (i) => slideEdit('delete-slide', i),
    current: activeIndex,
  })
  let panel = makePanel()
  // After slides were added or removed: a new list, shown if editing is on.
  function rebuildPanel() {
    panel.hide()
    panel = makePanel()
    if (on) panel.show()
    lastIndex = -1
  }
  let thumbTimer = null
  const refreshThumb = () => {
    clearTimeout(thumbTimer)
    const i = activeIndex()
    thumbTimer = setTimeout(() => panel.refresh(i), 300)
  }

  const layer = document.createElement('div')
  layer.className = 'se-layer'
  layer.innerHTML = `<div class="se-hover"></div><div class="se-box">${HANDLES.map((h) => `<span class="se-handle" data-handle="${h}"></span>`).join('')}</div><div class="se-marquee"></div><div class="se-guide se-guide-v"></div><div class="se-guide se-guide-h"></div>`
  document.body.append(layer)
  const hoverBox = layer.querySelector('.se-hover')
  const selectBox = layer.querySelector('.se-box')
  const marquee = layer.querySelector('.se-marquee')
  const guideV = layer.querySelector('.se-guide-v')
  const guideH = layer.querySelector('.se-guide-h')
  const outlines = [] // one per selected block that has no handles

  let statusTimer = null
  function setStatus(text, kind = '') {
    clearTimeout(statusTimer)
    statusEl.textContent = text
    statusEl.dataset.kind = kind
    if (kind === 'ok') statusTimer = setTimeout(() => { statusEl.textContent = '' }, 1800)
  }

  function describe(el) {
    if (isTitle(el)) return 'Title'
    const name = el.tagName
    if (el.closest('.demo-note') || el.getAttribute('slot') === 'note') return 'Demo note'
    if (name === 'UL' || name === 'OL') return 'List'
    if (name === 'P') return 'Paragraph'
    if (name === 'PRE') return 'Code'
    if (name === 'BLOCKQUOTE') return 'Quote'
    if (el.matches('.katex-display, [id^="eq-"]')) return 'Equation'
    if (name === 'ASTRO-ISLAND' || name === 'FIGURE' || el.localName === 'svg' || el.matches('.slide-box')) return 'Figure'
    return el.localName
  }
  const isFigure = (el) => describe(el) === 'Figure'

  // The toolbar acts on what is selected: the element inside a block, or the selected blocks.
  const targets = () => (inner ? [inner.el] : selection)

  function renderToolbar() {
    const any = !!(inner || selection.length)
    toolbar.classList.toggle('se-has-block', any)
    button('undo').disabled = !history.undo
    button('redo').disabled = !history.redo
    button('delete').disabled = !any || (!inner && selection.every(isTitle))
    button('delete').textContent = inner ? 'Hide' : 'Delete'
    button('text').disabled = !!inner || selection.length !== 1
    toolbar.querySelectorAll('[data-act="layer"]').forEach((b) => { b.disabled = !!inner })
    const what = toolbar.querySelector('.se-what')
    if (!any) {
      what.textContent = activeSlide() ? `Slide ${activeIndex() + 1}` : ''
      return
    }
    const shown = inner?.el ?? primary()
    const cs = getComputedStyle(shown)
    const part = inner && [...inner.el.classList].find((c) => !STATE_CLASS.test(c))
    what.textContent = words ? `Slide ${slideOf(words) + 1} · ${describe(words)} · words` : inner
      ? `Slide ${slideOf(inner.block) + 1} · ${describe(inner.block)} › ${inner.el.localName}${part ? `.${part}` : ''}`
      : selection.length > 1 ? `Slide ${slideOf(primary()) + 1} · ${selection.length} blocks` : `Slide ${slideOf(primary()) + 1} · ${describe(primary())}`
    if (document.activeElement !== sizeInput) sizeInput.value = round(parseFloat(cs.fontSize))
    // The font: its own value, or "Default" named after the font it has from the page.
    const font = ownValue(shown, 'font-family') ?? ''
    fontSelect.value = FONTS.some(([, v]) => v === font) ? font : ''
    fontSelect.options[0].textContent = `Default${font ? '' : ` (${fontName(cs.fontFamily) ?? 'page'})`}`
    button('bold').classList.toggle('se-on', Number(cs.fontWeight) >= 600)
    button('italic').classList.toggle('se-on', cs.fontStyle === 'italic')
    const align = ownValue(shown, 'text-align')
    toolbar.querySelectorAll('[data-act="text-align"]').forEach((b) => b.classList.toggle('se-on', b.dataset.value === align))
    const { base, alpha } = splitAlpha(ownValue(shown, isSvg(shown) ? 'fill' : 'color'))
    toolbar.querySelectorAll('[data-act="color"]').forEach((b) => b.classList.toggle('se-on', (b.dataset.value || '') === (base ?? '')))
    if (document.activeElement !== opacityInput) showOpacity(alpha)
    toolbar.querySelector('.se-color-now').style.background = cs[isSvg(shown) ? 'fill' : 'color']
  }

  // Keep the keyboard focus where it was when a toolbar button is pressed.
  toolbar.addEventListener('mousedown', (event) => { if (event.target.closest('button')) event.preventDefault() })
  toolbar.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-act]')
    if (!b || b.disabled) return
    const act = b.dataset.act
    if (act === 'help') {
      helpEl.hidden = !helpEl.hidden
      b.setAttribute('aria-expanded', String(!helpEl.hidden))
      return
    }
    if (act === 'done') return turnOff()
    if (act === 'palette') return togglePalette()
    if (act === 'eyedrop') return eyedrop()
    if (act === 'undo' || act === 'redo') return undo(act)
    if (act === 'add') return addText()
    if (!targets().length) return
    ;({
      smaller: () => stepSize(-2),
      larger: () => stepSize(2),
      bold: () => (wordsRange() ? styleWords({ mark: 'strong' }) : toggleBold()),
      italic: () => (wordsRange() ? styleWords({ mark: 'emphasis' }) : toggleItalic()),
      'text-align': () => textAlign(b.dataset.value),
      color: () => { togglePalette(false); applyColor(withAlpha(b.dataset.value || null, Number(opacityInput.value))) },
      align: () => alignObjects(b.dataset.value),
      layer: () => reorder(b.dataset.value),
      text: () => openEditor(primary()),
      reset: resetStyle,
      delete: removeSelection,
    })[act]?.()
  })
  fontSelect.addEventListener('change', () => {
    if (targets().length) setEach(() => ({ 'font-family': fontSelect.value || null }), true)
    fontSelect.blur()
  })
  // The opacity slider. A block's color changes as it moves and is written once it has been still
  // for COMMIT_DELAY, as a run of nudges is: one step to undo. Selected words are styled once, after
  // the same pause, and the palette closes: the page draws the block again, and its words are no
  // longer selected. The words are taken when the slider is, since a press on it ends the page's
  // selection.
  let opacityWords = null
  let wordsTimer = null
  const takeWords = () => { opacityWords = wordsRange() }
  opacityInput.addEventListener('pointerdown', takeWords)
  opacityInput.addEventListener('focus', () => { if (!opacityWords) takeWords() })
  opacityInput.addEventListener('input', () => {
    const alpha = Number(opacityInput.value)
    showOpacity(alpha)
    if (opacityWords || !targets().length) return
    setEach((el) => {
      const property = isSvg(el) ? 'fill' : 'color'
      const { base } = splitAlpha(ownValue(el, property))
      // an SVG shape with no fill of its own keeps the fill it has from the page
      return { [property]: withAlpha(base ?? (property === 'fill' && alpha < 100 ? getComputedStyle(el).fill : null), alpha) }
    })
  })
  opacityInput.addEventListener('change', () => {
    if (!opacityWords) return
    const range = opacityWords
    clearTimeout(wordsTimer)
    wordsTimer = setTimeout(() => {
      const span = range.dom.commonAncestorContainer.parentElement?.closest('span[style]')
      const base = span && words?.contains(span) ? splitAlpha(span.style.color).base : null
      opacityWords = null
      togglePalette(false)
      opacityInput.blur()
      styleWords({ color: withAlpha(base, Number(opacityInput.value)) }, range)
    }, COMMIT_DELAY)
  })
  sizeInput.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter' && targets().length) {
      const value = clamp(round(Number(sizeInput.value)), 6, 400)
      if (value) setEach(() => ({ 'font-size': `${value}px` }), true)
      sizeInput.blur()
    } else if (event.key === 'Escape') sizeInput.blur()
  })

  // --- selection ---------------------------------------------------------------------------------
  function select(els) {
    const next = [...new Set(els.filter(Boolean))]
    if (!inner && next.length === selection.length && next.every((el, i) => el === selection[i])) return
    flush()
    inner = null
    if (words && !next.includes(words)) exitWords()
    // A figure's slider or button may still have the focus, and with it the arrow keys: take it.
    if (next.length && deck.contains(document.activeElement)) document.activeElement.blur()
    selection = next
    store({ select: selection.map((el) => el.dataset.edit) })
    renderToolbar()
  }

  // An element inside a block; its rules come from the dev server, and edits wait for them.
  function selectInner(block, el) {
    if (!el || el === block || !block.contains(el)) return select([block])
    select([block])
    inner = { block, el, selector: selectorFor(block, el) }
    renderToolbar()
    loadRules(block).then(renderToolbar, failed)
  }

  function place(box, el) {
    if (!el) { box.style.display = 'none'; return }
    const r = rectOf(el)
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }

  let lastIndex = -1
  function frame() {
    if (!on) return
    const slide = activeSlide()
    const index = activeIndex()
    if (index !== lastIndex) {
      lastIndex = index
      panel.mark(index)
      if (selection.some((el) => !slide?.contains(el))) select([])
      renderToolbar()
    }
    if (selection.some((el) => !el.isConnected)) select([])
    if (hovered && !slide?.contains(hovered)) hovered = null
    // Handles for the one selected block; an outline for each of several, and for the block around
    // a selected element inside it.
    const handled = !inner && selection.length === 1 ? selection[0] : null
    place(selectBox, inner?.el ?? handled)
    selectBox.classList.toggle('se-no-scale', !!handled && (isFigure(handled) || !!editor))
    selectBox.classList.toggle('se-inner', !!inner)
    const outlined = inner ? [inner.block] : handled ? [] : selection
    while (outlines.length < outlined.length) { const o = document.createElement('div'); o.className = 'se-outline'; layer.append(o); outlines.push(o) }
    outlines.forEach((o, i) => place(o, outlined[i] ?? null))
    place(hoverBox, !dragging && hovered && !selection.includes(hovered) && hovered !== inner?.el ? hovered : null)
    requestAnimationFrame(frame)
  }

  function cycle(step) {
    const blocks = blocksOf(activeSlide())
    if (!blocks.length) return
    const at = blocks.indexOf(primary())
    select([at < 0 ? blocks.at(step > 0 ? 0 : -1) : blocks[(at + step + blocks.length) % blocks.length]])
  }

  // --- moving and resizing -----------------------------------------------------------------------
  function showGuide(guide, at) {
    if (at == null) { guide.style.display = 'none'; return }
    const d = deck.getBoundingClientRect()
    guide.style.display = 'block'
    if (guide === guideV) Object.assign(guide.style, { left: `${at}px`, top: `${d.top}px`, height: `${d.height}px` })
    else Object.assign(guide.style, { top: `${at}px`, left: `${d.left}px`, width: `${d.width}px` })
  }

  const listen = (move, up) => {
    const end = (ev) => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      up(ev)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
  }

  // Move the selected blocks together (or the element inside a block) by the pointer's travel. The
  // one under the pointer snaps to where it started and to the stage's center lines.
  function startMove(event, lead) {
    const movers = targets().map((el) => {
      const [x, y] = readTranslate(el)
      return { el, unit: unitOf(el), x, y, initial: el.style.getPropertyValue('translate') || null }
    })
    const leader = movers.find((m) => m.el === lead) ?? movers[0]
    if (!leader) return
    const r = rectOf(leader.el)
    const home = { left: r.left - leader.x * leader.unit, top: r.top - leader.y * leader.unit, width: r.width, height: r.height } // screen box at translate 0
    const start = { x: event.clientX, y: event.clientY }
    const within = inner
    let moved = false
    listen((ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return
      moved = true
      dragging = true
      let dx = leader.x * leader.unit + ev.clientX - start.x
      let dy = leader.y * leader.unit + ev.clientY - start.y
      let gx = null
      let gy = null
      if (!(ev.metaKey || ev.ctrlKey)) {
        const d = deck.getBoundingClientRect()
        const scale = stageScale()
        const near = SNAP * scale
        const centerX = d.left + (STAGE.width / 2) * scale
        const centerY = d.top + (STAGE.height / 2) * scale
        const toCenterX = centerX - home.left - home.width / 2
        const toCenterY = centerY - home.top - home.height / 2
        if (Math.abs(dx) < near && Math.abs(dx) <= Math.abs(dx - toCenterX)) { dx = 0; gx = home.left }
        else if (Math.abs(dx - toCenterX) < near) { dx = toCenterX; gx = centerX }
        if (Math.abs(dy) < near && Math.abs(dy) <= Math.abs(dy - toCenterY)) { dy = 0; gy = home.top }
        else if (Math.abs(dy - toCenterY) < near) { dy = toCenterY; gy = centerY }
      }
      showGuide(guideV, gx)
      showGuide(guideH, gy)
      // Every element moves by the leader's travel on screen, in its own CSS px.
      const tx = dx - leader.x * leader.unit
      const ty = dy - leader.y * leader.unit
      for (const m of movers) m.el.style.setProperty('translate', `${round(m.x + tx / m.unit)}px ${round(m.y + ty / m.unit)}px`)
    }, () => {
      showGuide(guideV, null)
      showGuide(guideH, null)
      dragging = false
      if (!moved) return
      for (const m of movers) {
        const translate = translateValue(...readTranslate(m.el))
        applyStyle(m.el, { translate: m.initial }) // so that stage() records the value from before the drag
        if (within) stageInner(within.block, within.selector, { translate })
        else stage(m.el, { translate })
      }
      flush()
    })
  }

  // A side handle sets the width; a corner scales the font size and the width together, as a text
  // box does. The opposite edge or corner stays where it was. A width the stylesheet caps with a
  // max-width (a paragraph's 1320px) lifts the cap.
  function startResize(event, handle) {
    const el = primary()
    const unit = unitOf(el)
    const r0 = rectOf(el)
    const w0 = r0.width / unit
    const size0 = parseFloat(getComputedStyle(el).fontSize)
    const corner = handle.length === 2 && !isFigure(el)
    const left = handle.includes('w')
    const top = handle.includes('n')
    const anchor = { x: left ? r0.right : r0.left, y: top ? r0.bottom : r0.top }
    const start = event.clientX
    const set = {}
    const initial = Object.fromEntries(['font-size', 'width', 'max-width', 'translate'].map((p) => [p, el.style.getPropertyValue(p) || null]))
    dragging = true
    listen((ev) => {
      const dx = ((ev.clientX - start) / unit) * (left ? -1 : 1)
      const k = Math.max(0.1, (w0 + dx) / w0)
      if (corner) set['font-size'] = `${clamp(round(size0 * k), 6, 400)}px`
      const width = Math.max(24, round(corner ? w0 * k : w0 + dx))
      set.width = `${width}px`
      applyStyle(el, set)
      if (rectOf(el).width / unit < width - 1) { set['max-width'] = 'none'; applyStyle(el, set) }
      // Hold the fixed edge: shift the block by however far that edge moved.
      const r = rectOf(el)
      const [x, y] = readTranslate(el)
      const ex = (anchor.x - (left ? r.right : r.left)) / unit
      const ey = (anchor.y - (top ? r.bottom : r.top)) / unit
      el.style.setProperty('translate', `${round(x + ex)}px ${round(y + ey)}px`)
      renderToolbar()
    }, () => {
      dragging = false
      if (!Object.keys(set).length) return
      const final = { ...set, translate: translateValue(...readTranslate(el)) }
      applyStyle(el, initial) // so that stage() records the values from before the drag
      stage(el, final, { now: true })
    })
  }

  // Draw a box on the slide's background: it selects every block it touches.
  function startMarquee(event, add) {
    const start = { x: event.clientX, y: event.clientY }
    const base = add ? [...selection] : []
    let moved = false
    listen((ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return
      moved = true
      const box = new DOMRect(Math.min(start.x, ev.clientX), Math.min(start.y, ev.clientY), Math.abs(ev.clientX - start.x), Math.abs(ev.clientY - start.y))
      Object.assign(marquee.style, { display: 'block', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
      const touched = blocksOf(activeSlide()).filter((el) => {
        const r = rectOf(el)
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
      })
      select([...base, ...touched.filter((el) => !base.includes(el))])
    }, () => {
      marquee.style.display = 'none'
      if (!moved && !add) select([])
    })
  }

  // --- changes of CSS for what is selected ---------------------------------------------------------
  // `make(el)` gives the properties for one element; an element inside a block writes its rule.
  function setEach(make, now = false) {
    if (inner) stageInner(inner.block, inner.selector, make(inner.el), { now })
    else for (const el of selection) stage(el, make(el), { now })
  }

  function nudge(dx, dy) {
    setEach((el) => {
      const [x, y] = readTranslate(el)
      return { translate: translateValue(x + dx, y + dy) }
    })
  }

  function stepSize(delta) {
    setEach((el) => ({ 'font-size': `${clamp(round(parseFloat(getComputedStyle(el).fontSize)) + delta, 6, 400)}px` }))
  }

  // An element's own value: its inline style for a block, its rule for an element inside one.
  function ownValue(el, property) {
    if (inner && el === inner.el) return innerValue(inner.block.dataset.edit, inner.selector, property)
    return el.style.getPropertyValue(property) || null
  }
  // Bold and italic: the own value comes off, or the opposite of what the shown element has now goes
  // on (so ⌘B on a bold title makes it regular).
  function toggleBold() {
    const shown = targets().at(-1)
    const value = ownValue(shown, 'font-weight') ? null : Number(getComputedStyle(shown).fontWeight) >= 600 ? '400' : '700'
    setEach(() => ({ 'font-weight': value }), true)
  }
  function toggleItalic() {
    const shown = targets().at(-1)
    const value = ownValue(shown, 'font-style') ? null : getComputedStyle(shown).fontStyle === 'italic' ? 'normal' : 'italic'
    setEach(() => ({ 'font-style': value }), true)
  }
  function textAlign(value) {
    const same = ownValue(targets().at(-1), 'text-align') === value
    setEach(() => ({ 'text-align': same ? null : value }), true)
  }
  // An SVG shape or label takes its color as fill.
  const setColor = (value) => setEach((el) => ({ [isSvg(el) ? 'fill' : 'color']: value }), true)
  // A color with an opacity below 100% is written as color-mix(in srgb, <color> <p>%, transparent), so
  // a theme color keeps its name and still follows the theme. The default color (null) mixes the
  // color the element has from the page (currentColor).
  function splitAlpha(value) {
    const m = value && /^color-mix\(in srgb, (.+) (\d+(?:\.\d+)?)%, transparent\)$/.exec(value)
    return m ? { base: m[1] === 'currentColor' || m[1] === 'currentcolor' ? null : m[1], alpha: Number(m[2]) } : { base: value || null, alpha: 100 }
  }
  const withAlpha = (base, alpha) => (alpha >= 100 ? base : `color-mix(in srgb, ${base ?? 'currentColor'} ${alpha}%, transparent)`)
  function showOpacity(alpha) {
    opacityInput.value = String(alpha)
    opacityOut.textContent = `${alpha}%`
  }
  // The name of the font menu's font that the page gives an element, if it is one of them.
  function fontName(family) {
    const probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.append(probe)
    const found = FONTS.find(([, value]) => { probe.style.fontFamily = value; return getComputedStyle(probe).fontFamily === family })
    probe.remove()
    return found?.[0]
  }

  // --- colors: the palette, the eyedropper, and the recent colors -----------------------------------
  const palette = () => toolbar.querySelector('.se-palette')
  function togglePalette(open = palette().hidden) {
    palette().hidden = !open
    button('palette').setAttribute('aria-expanded', String(open))
    // a closed palette gives the keys back to the stage
    if (!open && palette().contains(document.activeElement)) document.activeElement.blur()
    if (!open) return
    renderRecent()
    palette().style.left = `${Math.min(button('palette').getBoundingClientRect().left, innerWidth - 290)}px`
  }
  const recentColors = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [] } catch { return [] } }
  function remember(color) {
    const list = [color, ...recentColors().filter((c) => c !== color)].slice(0, RECENT)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch {}
    renderRecent()
  }
  function renderRecent() {
    const list = recentColors()
    toolbar.querySelector('.se-recent').innerHTML = list.length
      ? list.map((c) => `<button type="button" data-act="color" data-value="${html(c)}" title="${html(c)}"><span style="background: ${html(c)}"></span></button>`).join('')
      : '<span class="se-none">none yet</span>'
  }
  // A color as the theme names it, when it is one of the theme's colors now: then it follows the
  // theme (light and dark); otherwise it stays the color that was taken.
  // The theme's colors as the page computes them now (light or dark), for asToken.
  function themeColors() {
    const probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.append(probe)
    const list = TOKENS.map((token) => { probe.style.color = `var(${token})`; return [token, getComputedStyle(probe).color] })
    const color = (value) => { probe.style.color = value; return getComputedStyle(probe).color }
    const out = { list, color }
    out.done = () => probe.remove()
    return out
  }
  function asToken(color, theme = themeColors()) {
    const want = theme.color(color)
    const token = theme.list.find(([, value]) => value === want)?.[0]
    if (!arguments[1]) theme.done()
    return token ? `var(${token})` : color
  }
  // The stage, the slide list and the toolbar as still copies, each where it is: the eyedropper
  // magnifies them (only the slide shown, of the deck's slides).
  function magnified() {
    const viewport = document.querySelector('.deck-viewport')
    const stage = viewport?.cloneNode(false)
    const copy = deck.cloneNode(false)
    if (activeSlide()) copy.append(stillCopy(activeSlide()))
    stage?.append(copy)
    const list = on ? stillCopy(panel.element) : null
    if (list) list.dataset.seScroll = String(panel.element.scrollTop)
    return [stage, list, stillCopy(toolbar)].filter(Boolean)
  }
  // Take a color from anywhere on the page (eyedropper.js), and give it to the selected words or
  // blocks. A theme color is written by its name, so that it follows the theme.
  async function eyedrop() {
    const range = wordsRange()
    togglePalette(false)
    setStatus('Click to take a color; Esc puts the eyedropper away', 'busy')
    const theme = themeColors()
    picking = true
    let color
    try {
      color = await pickColor({
        magnify: magnified(),
        nameOf: (value) => {
          const token = asToken(value, theme)
          return token.startsWith('var(') ? `${token.slice(6, -1)} · ${hex(value)}` : null
        },
      })
    } finally {
      picking = false
    }
    const value = color && asToken(color, theme)
    theme.done()
    setStatus('')
    if (!value) return
    remember(value)
    applyColor(value, range)
  }
  function applyColor(value, range = wordsRange()) {
    if (range) return styleWords({ color: value }, range)
    if (targets().length) setColor(value)
  }

  // --- words: double-click a text block, then select words on the slide ----------------------------
  function enterWords(block, x, y) {
    exitWords()
    select([block])
    words = block
    block.classList.add('se-words')
    // the word under the pointer, as a double-click selects it
    const at = document.caretRangeFromPoint?.(x, y)
    const selection = getSelection()
    if (at && block.contains(at.startContainer)) {
      selection.removeAllRanges()
      selection.addRange(at)
      selection.modify?.('move', 'backward', 'word')
      selection.modify?.('extend', 'forward', 'word')
    }
    setStatus(WORDS_HINT, 'busy')
    renderToolbar()
  }
  const WORDS_HINT = 'Select words; then B, I or a color styles them. Enter edits the Markdown, Esc ends.'
  function exitWords() {
    if (!words) return
    words.classList.remove('se-words')
    words = null
    getSelection().removeAllRanges()
    if (statusEl.textContent === WORDS_HINT) setStatus('')
  }
  // The selected words, as the block's text (what the dev server compares with slides.mdx: text
  // nodes, not math or a mark's glyph) and the selection's place in it.
  function wordsRange() {
    const range = words && getSelection().rangeCount ? getSelection().getRangeAt(0) : null
    if (!range || range.collapsed || !words.contains(range.commonAncestorContainer)) return null
    const skip = (n) => n.parentElement?.closest('.katex, [aria-hidden="true"], style, script, template')
    const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
    let plain = ''
    let start = null
    let end = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (start == null) {
        if (n === range.startContainer) start = plain.length + range.startOffset
        else if (range.comparePoint(n, 0) === 0) start = plain.length
      }
      if (n === range.endContainer) end = plain.length + range.endOffset
      else if (range.comparePoint(n, n.length) === 0) end = plain.length + n.length
      plain += n.data
    }
    return start == null || end == null || end <= start ? null : { plain, start, end, dom: range.cloneRange() }
  }
  // The words' new style, shown at once: they go in a <strong>, <em> or colored <span> on the page
  // until the server's render of the block replaces it. Returns what puts the block's children back,
  // or null when the render alone shows the change: a mark or a color taken off, or words in math, a
  // figure, or more than one paragraph or list item.
  function previewWords(block, dom, { mark, color }) {
    const texts = []
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (dom.intersectsNode(n) && n.data.trim()) texts.push(n)
    const lines = new Set(texts.map((n) => n.parentElement.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote')))
    const within = (n, selector) => block.contains(n.parentElement.closest(selector))
    if (!texts.length || lines.size !== 1 || texts.some((n) => n.parentElement.closest('.katex, astro-island, svg'))) return null
    if (mark ? texts.every((n) => within(n, mark === 'strong' ? 'strong, b' : 'em, i')) : !color) return null
    const backup = [...block.childNodes].map((n) => n.cloneNode(true))
    const wrapper = document.createElement(mark === 'strong' ? 'strong' : mark === 'emphasis' ? 'em' : 'span')
    if (!mark) wrapper.style.color = color
    wrapper.append(dom.extractContents())
    dom.insertNode(wrapper)
    const shown = document.createRange()
    shown.selectNodeContents(wrapper)
    getSelection().removeAllRanges()
    getSelection().addRange(shown)
    return () => block.replaceChildren(...backup)
  }
  function styleWords(style, range = wordsRange()) {
    if (!range || !words) return
    const { dom, ...selected } = range
    const id = words.dataset.edit
    const revert = previewWords(words, dom, style)
    structural({ type: 'words', id, ...selected, ...style }, (data) => {
      if (!data.rerender) return revert?.() // slides.mdx did not change, so neither does the page
      // the page drew the block again: go on selecting words in the new one
      words = null
      const el = byId(id)
      if (!el) return
      select([el])
      words = el
      el.classList.add('se-words')
    }, revert)
  }

  function resetStyle() {
    if (inner) {
      const rule = rulesOf.get(inner.block.dataset.edit)?.find(([s]) => s === inner.selector)
      if (rule?.[1].length) stageInner(inner.block, inner.selector, Object.fromEntries(rule[1].map(([p]) => [p, null])), { now: true })
      return
    }
    for (const el of selection) {
      const set = Object.fromEntries(MANAGED.filter((p) => el.style.getPropertyValue(p)).map((p) => [p, null]))
      if (Object.keys(set).length) stage(el, set)
      // and the CSS for the elements inside it, when the editor has read it
      for (const [selector, declarations] of rulesOf.get(el.dataset.edit) ?? []) if (declarations.length) stageInner(el, selector, Object.fromEntries(declarations.map(([p]) => [p, null])))
    }
    flush()
  }

  // Align: several blocks to the box around them all; one block to the slide's content box; an
  // element inside a block to the block.
  function alignObjects(how) {
    const els = targets()
    const bounds = inner ? rectOf(inner.block) : els.length > 1 ? union(els.map(rectOf)) : contentBox(activeSlide())
    setEach((el) => {
      const r = rectOf(el)
      const unit = unitOf(el)
      const [x, y] = readTranslate(el)
      const dx = { left: bounds.left - r.left, hcenter: bounds.left + bounds.width / 2 - (r.left + r.width / 2), right: bounds.right - r.right }[how] ?? 0
      const dy = { top: bounds.top - r.top, vcenter: bounds.top + bounds.height / 2 - (r.top + r.height / 2), bottom: bounds.bottom - r.bottom }[how] ?? 0
      return { translate: translateValue(x + dx / unit, y + dy / unit) }
    }, true)
  }

  // Layer order, as z-index. A block without one paints in the flow, below a block with z-index 0; a
  // moved block (translate) paints at 0 too. Blocks at one level paint in their order on the slide.
  function layerOf(el) {
    const z = parseInt(el.style.zIndex, 10)
    return Number.isFinite(z) ? z : el.style.translate ? 0 : -0.5
  }
  function reorder(how) {
    const blocks = blocksOf(activeSlide())
    const order = () => blocks.map((el, dom) => ({ el, dom, z: layerOf(el) })).sort((a, b) => a.z - b.z || a.dom - b.dom)
    const at = (el) => order().findIndex((o) => o.el === el)
    const up = how === 'forward' || how === 'front'
    for (const el of [...selection].sort((a, b) => (up ? at(b) - at(a) : at(a) - at(b)))) {
      const list = order()
      const i = at(el)
      const me = list[i]
      const others = list.filter((o) => !selection.includes(o.el))
      let z = null
      if (how === 'front' && others.length) z = Math.max(0, ...others.map((o) => Math.ceil(o.z))) + 1
      if (how === 'back' && others.length) z = Math.min(0, ...others.map((o) => Math.floor(o.z))) - 1
      if (how === 'forward' && list[i + 1]) { const next = list[i + 1]; z = next.z === -0.5 ? 0 : next.z + (me.dom > next.dom ? 0 : 1) }
      if (how === 'backward' && list[i - 1]) { const prev = list[i - 1]; z = prev.z === -0.5 ? -1 : prev.z - (me.dom < prev.dom ? 0 : 1) }
      if (z == null || z === me.z) continue
      const set = { 'z-index': String(z) }
      // z-index needs a flex or grid item, or a positioned element.
      const parent = el.parentElement ? getComputedStyle(el.parentElement).display : ''
      if (getComputedStyle(el).position === 'static' && !/flex|grid/.test(parent)) set.position = 'relative'
      stage(el, set)
    }
    flush()
  }

  // --- text: the block's Markdown, edited in place -----------------------------------------------
  function wrapSelection(area, mark) {
    const { selectionStart: a, selectionEnd: b, value } = area
    const inside = value.slice(a, b)
    const outside = value.slice(a - mark.length, a) === mark && value.slice(b, b + mark.length) === mark
    let from = a
    let to = b
    let text
    if (inside.length >= 2 * mark.length && inside.startsWith(mark) && inside.endsWith(mark)) text = inside.slice(mark.length, -mark.length)
    else if (outside) { from = a - mark.length; to = b + mark.length; text = inside }
    else text = mark + inside + mark
    area.focus()
    area.setSelectionRange(from, to)
    // insertText keeps the textarea's own undo; setRangeText is the fallback.
    if (!document.execCommand('insertText', false, text)) area.setRangeText(text, from, to, 'end')
    const wrapped = text === mark + inside + mark
    const caret = wrapped ? from + mark.length : from
    area.setSelectionRange(caret, caret + (wrapped ? inside.length : text.length))
  }

  async function openEditor(el) {
    if (!el) return
    flush()
    const id = el.dataset.edit
    let data
    try { data = await send('read', { id }) } catch (error) { return failed(error) }
    closeEditor()
    const box = document.createElement('div')
    box.className = 'se-source'
    box.innerHTML = `<textarea spellcheck="false" aria-label="Markdown of the block"></textarea>
      <div class="se-source-bar"><span class="se-source-hint">${data.singleLine ? 'Enter saves' : '⌘Enter saves'} · Esc cancels · ⌘B / ⌘I: ** / * around the selection</span>
      <span class="se-source-error" role="alert"></span>
      <button type="button" data-act="cancel">Cancel</button><button type="button" data-act="save" class="se-primary">Save</button></div>`
    const area = box.querySelector('textarea')
    area.value = data.text
    document.body.append(box)
    const r = rectOf(el)
    const width = clamp(Math.max(r.width, 560), 320, innerWidth - 16)
    Object.assign(box.style, { left: `${clamp(r.left, 8, innerWidth - width - 8)}px`, top: `${clamp(r.top, 52, innerHeight - 160)}px`, width: `${width}px` })
    const fit = () => { area.style.height = 'auto'; area.style.height = `${Math.min(area.scrollHeight + 2, innerHeight * 0.6)}px` }
    fit()
    area.addEventListener('input', fit)
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
    select([el])
    editor = { panel: box, area, id, singleLine: data.singleLine, original: data.text }
    store({ editText: null })
    area.addEventListener('keydown', (event) => {
      const mod = event.metaKey || event.ctrlKey
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); closeEditor() }
      else if (event.key === 'Enter' && (mod || data.singleLine)) { event.preventDefault(); saveText() }
      else if (mod && (event.key === 'b' || event.key === 'i')) { event.preventDefault(); wrapSelection(area, event.key === 'b' ? '**' : '*') }
    })
    box.querySelector('[data-act="cancel"]').addEventListener('click', closeEditor)
    box.querySelector('[data-act="save"]').addEventListener('click', saveText)
  }

  function closeEditor() {
    editor?.panel.remove()
    editor = null
  }

  async function saveText() {
    if (!editor || editor.panel.classList.contains('se-busy')) return
    const { panel: box, area, id } = editor
    box.classList.add('se-busy')
    try {
      await send('edit', { edit: { type: 'text', id, text: area.value } })
      closeEditor()
      setStatus('Saved', 'ok')
      select([area.value.trim() ? byId(id) : null])
    } catch (error) {
      box.classList.remove('se-busy')
      box.querySelector('.se-source-error').textContent = error.message
      if (error.data?.reload) failed(error)
    }
  }

  // --- edits that change the deck's text, blocks or slides: drawn from the server's render ---------
  // `revert` takes back what the page showed ahead of the render, if the edit fails.
  async function structural(edit, then, revert) {
    flush()
    setStatus('Saving…', 'busy')
    try {
      const data = await send('edit', { edit })
      setStatus('Saved', 'ok')
      then?.(data)
      refreshThumb()
    } catch (error) {
      revert?.()
      failed(error)
    }
  }

  function addText() {
    const blocks = blocksOf(activeSlide()).filter((b) => !isTitle(b))
    const after = primary()?.dataset.edit ?? blocks.at(-1)?.dataset.edit ?? `${activeIndex()}/t`
    structural({ type: 'insert', after, text: 'New text' }, (data) => openEditor(byId(data.id)))
  }

  // Later blocks first, so that each edit's ids still hold when it runs.
  const lastFirst = (els) => [...els].sort((a, b) => blockIndex(b) - blockIndex(a))
  const oneOrBatch = (edits) => (edits.length === 1 ? edits[0] : { type: 'batch', edits })

  function removeSelection() {
    if (inner) return setEach(() => ({ display: 'none' }), true)
    const els = lastFirst(selection.filter((el) => !isTitle(el)))
    if (!els.length) return
    els.forEach((el) => { el.style.opacity = '0.3' })
    select([])
    structural(oneOrBatch(els.map((el) => ({ type: 'delete', id: el.dataset.edit }))))
  }

  function duplicateSelection() {
    const els = lastFirst(selection.filter((el) => !isTitle(el)))
    if (!els.length) return
    structural(oneOrBatch(els.map((el) => ({ type: 'duplicate', id: el.dataset.edit }))), (data) => select(els.length === 1 ? [byId(data.id)] : []))
  }

  function slideEdit(type, index) {
    if (index < 0) return
    if (type === 'delete-slide') slideList()[index].style.opacity = '0.3'
    select([])
    structural({ type, slide: index }, (data) => panel.focus(data.slide))
  }

  async function undo(action) {
    flush()
    exitWords()
    let data
    try { data = await send(action) } catch (error) { return failed(error) }
    renderToolbar()
    if (data.nothing) return setStatus(`Nothing to ${action}`, 'ok')
    if (data.apply) {
      const els = []
      for (const edit of data.apply) {
        const el = byId(edit.id)
        if (!el) continue
        if (edit.type === 'inner') {
          // The file is the truth: read the block's rules again.
          rulesOf.delete(edit.id)
          loading.delete(edit.id)
          await loadRules(el).catch(failed)
        } else applyStyle(el, edit.set)
        els.push(el)
      }
      if (els[0] && slideList()[slideOf(els[0])] !== activeSlide()) location.hash = `#${slideOf(els[0]) + 1}`
      requestAnimationFrame(() => select(els))
      refreshThumb()
    }
    setStatus(action === 'undo' ? 'Undone' : 'Redone', 'ok')
  }

  // --- on and off --------------------------------------------------------------------------------
  // The page's blocks must be the file's: otherwise an edit could land on another block.
  function mismatch(outline) {
    const slides = slideList()
    if (outline.slides.length !== slides.length) return `the page has ${slides.length} slides and slides.mdx has ${outline.slides.length}`
    for (const [i, slide] of slides.entries()) {
      const sort = (ids) => ids.map((id) => Number(id.split('/')[1])).sort((a, b) => a - b).join()
      const page = sort(blocksOf(slide).map((b) => b.dataset.edit).filter((id) => !id.endsWith('/t')))
      if (slide.dataset.editSlide !== String(i) || page !== sort(outline.slides[i].blocks)) return `slide ${i + 1} on the page is not slide ${i + 1} of slides.mdx`
    }
    return null
  }

  async function turnOn() {
    let data
    try { data = await send('open') } catch (error) { document.body.classList.add('se-on'); return failed(error) }
    document.body.classList.add('se-on')
    // A dev server started before the editor's server half changed still runs the old one.
    const problem = data.protocol !== PROTOCOL ? 'the dev server runs an older slide editor; restart npm run dev' : mismatch(data.outline)
    if (problem) {
      toolbar.classList.add('se-blocked')
      setStatus(`Editing is off: ${problem}${data.protocol === PROTOCOL ? '. Reload the page.' : '.'}`, 'error')
      return
    }
    on = true
    toggle.classList.add('se-active')
    document.querySelector('[data-deck="exit"]')?.setAttribute('title', 'Stop editing (Esc)')
    store({ on: true })
    panel.show()
    lastIndex = -1
    renderToolbar()
    requestAnimationFrame(frame)
  }

  function turnOff() {
    flush()
    closeEditor()
    exitWords()
    togglePalette(false)
    select([])
    on = false
    hovered = null
    document.body.classList.remove('se-on')
    toolbar.classList.remove('se-blocked')
    toggle.classList.remove('se-active')
    document.querySelector('[data-deck="exit"]')?.setAttribute('title', 'Back to the post (Esc)')
    panel.hide()
    for (const box of [selectBox, hoverBox, ...outlines]) place(box, null)
    helpEl.hidden = true
    store({ on: false, select: [] })
  }

  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement && on) turnOff() })
  // ✕ in the nav, while editing: as Esc with nothing selected, it stops editing and stays on the deck.
  document.addEventListener('click', (event) => {
    if (!on || !(event.target instanceof Element) || !event.target.closest('[data-deck="exit"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    turnOff()
  }, true)
  // Back to the deck from the post, out of the browser's page cache: a reader's deck, not an editor.
  window.addEventListener('pageshow', (event) => { if (event.persisted && on) turnOff() })

  // --- pointer and keys (capture, ahead of the deck and its figures) ------------------------------
  const outsideStage = (target) => !(target instanceof Element) || !!target.closest('.se-toolbar, .se-source, .se-panel, .deck-nav, .deck-notes') || !deck.contains(target)
  const deepKey = (event) => event.metaKey || event.ctrlKey

  document.addEventListener('pointermove', (event) => {
    if (!on || dragging) return
    const { block, target } = event.altKey ? {} : under(event.clientX, event.clientY)
    hovered = block && deepKey(event) && target !== block ? target : block ?? null
  }, true)

  document.addEventListener('pointerdown', (event) => {
    if (!on || picking || event.button !== 0) return
    // Option+click: the figure under the pointer gets the click, and the arrow keys after it.
    passing = event.altKey && !outsideStage(event.target)
    if (passing) { select([]); return }
    const handle = event.target instanceof Element && event.target.closest('.se-handle')
    if (handle && primary()) {
      event.preventDefault()
      event.stopPropagation()
      return startResize(event, handle.dataset.handle)
    }
    if (outsideStage(event.target)) {
      if (!(event.target instanceof Element && event.target.closest('.se-palette, [data-act="palette"]'))) togglePalette(false)
      return
    }
    togglePalette(false)
    // Selecting words: the pointer selects text in the block, as on any page.
    if (words && words.contains(event.target)) return
    exitWords()
    event.preventDefault()
    event.stopPropagation()
    // The keys go to the stage again (from the slide list, say), since preventDefault keeps the focus.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
    // A click away from the Markdown editor keeps what was typed, as a text box does.
    if (editor) {
      if (editor.area.value !== editor.original) return saveText()
      closeEditor()
    }
    const { block, target } = under(event.clientX, event.clientY)
    if (!block) return startMarquee(event, event.shiftKey)
    if (deepKey(event) && target !== block) {
      selectInner(block, target)
      return startMove(event, inner?.el)
    }
    if (event.shiftKey) {
      select(selection.includes(block) ? selection.filter((el) => el !== block) : [...selection, block])
      if (!selection.includes(block)) return
    } else if (!selection.includes(block) || inner) select([block])
    startMove(event, block)
  }, true)

  // Clicks inside the stage select; they do not reach the figures or follow links, unless Option is held.
  for (const type of ['click', 'mousedown', 'mouseup', 'touchstart', 'contextmenu']) {
    document.addEventListener(type, (event) => {
      if (words && words.contains(event.target)) return
      if (on && !passing && !event.altKey && !outsideStage(event.target)) { event.preventDefault(); event.stopPropagation() }
    }, { capture: true, passive: false })
  }
  // Double-click: a figure opens to the element under the pointer; a block of text to its words
  // (then the pointer selects words; a double-click there selects a word, as on any page); code and
  // equations, which have no words to style, to their Markdown.
  document.addEventListener('dblclick', (event) => {
    if (!on || passing || event.altKey || outsideStage(event.target)) return
    if (words && words.contains(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    const { block, target } = under(event.clientX, event.clientY)
    if (!block) return
    if (isFigure(block) && target !== block) selectInner(block, target)
    else if (describe(block) === 'Code' || describe(block) === 'Equation') openEditor(block)
    else enterWords(block, event.clientX, event.clientY)
  }, true)

  const typing = (target) => target instanceof Element && target.closest('input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"]), textarea, select, [contenteditable]')

  window.addEventListener('keydown', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const code = event.code
    const mod = event.metaKey || event.ctrlKey
    const alt = event.altKey
    if (picking || editor || typing(event.target)) return
    // The palette's opacity slider keeps its arrow keys; Esc still closes the palette.
    if (event.target instanceof Element && event.target.closest('.se-palette') && event.key !== 'Escape') return
    if (code === 'KeyE' && !mod && !alt) {
      event.preventDefault()
      event.stopPropagation()
      return on ? turnOff() : turnOn()
    }
    if (!on) return
    const handled = () => { event.preventDefault(); event.stopPropagation() }
    // Esc goes out one level: from an element inside a block to the block, from the selection to
    // nothing, and from nothing out of editing. It never leaves the deck while editing.
    if (key === 'Escape') {
      handled()
      if (!palette().hidden) return togglePalette(false)
      if (words) return exitWords()
      if (inner) return select([inner.block])
      if (selection.length) return select([])
      return turnOff()
    }
    if (mod && code === 'KeyZ') { handled(); return undo(event.shiftKey ? 'redo' : 'undo') }
    if (mod && code === 'KeyY') { handled(); return undo('redo') }
    if (event.target instanceof Element && event.target.closest('.se-panel')) return // the slide list's own keys (panel.js)
    if (mod && !alt && code === 'KeyA') { handled(); return select(blocksOf(activeSlide())) }
    if (key === 'Tab') { handled(); return cycle(event.shiftKey ? -1 : 1) }
    if (!targets().length) return
    if (words) {
      // Selecting words: B and I style the selection; Enter edits the Markdown; arrows do nothing.
      if (mod && !alt && (code === 'KeyB' || code === 'KeyI')) { handled(); return wordsRange() ? styleWords({ mark: code === 'KeyB' ? 'strong' : 'emphasis' }) : code === 'KeyB' ? toggleBold() : toggleItalic() }
      if (key === 'Enter' && !mod) { handled(); const el = words; exitWords(); return openEditor(el) }
      if (key.startsWith('Arrow')) return handled()
    }
    const step = event.shiftKey ? 10 : 1
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[key] && !mod && !alt) { handled(); return nudge(...moves[key]) }
    if (key === 'Enter' && event.shiftKey && inner) { handled(); return select([inner.block]) }
    if (key === 'Enter' && !mod && !inner && selection.length === 1) { handled(); return openEditor(primary()) }
    if ((key === 'Delete' || key === 'Backspace') && !mod) { handled(); return removeSelection() }
    if (mod && !alt && code === 'KeyD') { handled(); return inner ? undefined : duplicateSelection() }
    if (mod && !alt && code === 'KeyB') { handled(); return toggleBold() }
    if (mod && !alt && code === 'KeyI') { handled(); return toggleItalic() }
    const texts = { KeyL: 'left', KeyT: 'center', KeyR: 'right' }
    if (mod && alt && texts[code]) { handled(); return textAlign(texts[code]) }
    if (mod && event.shiftKey && (code === 'Period' || key === '>')) { handled(); return stepSize(2) }
    if (mod && event.shiftKey && (code === 'Comma' || key === '<')) { handled(); return stepSize(-2) }
    if (mod && (code === 'BracketRight' || code === 'BracketLeft') && !inner) {
      handled()
      return reorder(code === 'BracketRight' ? (alt ? 'front' : 'forward') : (alt ? 'back' : 'backward'))
    }
    const aligns = { KeyA: 'left', KeyH: 'hcenter', KeyD: 'right', KeyW: 'top', KeyV: 'vcenter', KeyS: 'bottom' }
    if (alt && !mod && aligns[code]) { handled(); return alignObjects(aligns[code]) }
  }, true)

  // Editing was on when the page reloaded (a change of text reloads it): turn it back on, with the
  // same blocks selected. Coming to the deck any other way (S on the post, a link, Back), it is off.
  const saved = stored()
  const reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload'
  if (saved.on && reloaded) {
    turnOn().then(() => {
      if (!on) return
      if (Number.isInteger(saved.goto)) location.hash = `#${saved.goto + 1}`
      const els = [].concat(saved.select ?? []).map(byId).filter(Boolean)
      if (els[0] && slideList()[slideOf(els[0])] !== activeSlide()) location.hash = `#${slideOf(els[0]) + 1}`
      requestAnimationFrame(() => {
        select(els)
        if (saved.panel) panel.focus(Number.isInteger(saved.goto) ? saved.goto : activeIndex())
        if (els.length === 1 && saved.editText === els[0].dataset.edit) openEditor(els[0])
        store({ goto: null, panel: false })
      })
    })
  } else if (saved.on) store({ on: false, select: [] })
}
