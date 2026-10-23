// Jump to source, the page half (integration.js injects it into every page under `npm run dev`). A Cmd+Shift+click
// (Ctrl+Shift+click) on a post or a deck opens the file that wrote what is under the pointer, in VS Code, at the line and
// column of the word clicked: the MDX for text and math (annotate.js marks it), a figure's .svelte for an element of a
// figure (Svelte marks those in development). For what a component, a layout or the code highlighter writes (a code
// block, a slide's title, the post's title), the dev server looks for the words clicked in the MDX, between what comes
// before and after them, else opens the component's tag there. The click goes to nothing else on the page: not a link, a
// figure or the slide editor.
//
// The dev server opens the file itself when it runs on another machine that a VS Code window is connected to
// (vscode.js). Otherwise the page opens a vscode:// link: on this computer, or, for a dev server on another machine, through
// the SSH host that VS Code uses for it. The page asks for that host the first time and keeps it in this browser only;
// Cmd+Shift+Option+click (Ctrl+Shift+Alt+click) asks again.
const ENDPOINT = '/__jump-to-source'
const HOST = 'jump-to-source:ssh-host:' // + the dev server's host name -> the SSH host for it
const HOSTS = 'jump-to-source:ssh-hosts' // the SSH hosts given before, newest first

const pressed = (event) => event.shiftKey && (event.metaKey || event.ctrlKey) && event.button === 0
for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
  window.addEventListener(type, (event) => {
    if (!pressed(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (type === 'click') jump(event).catch((error) => toast(`Jump to source: ${error.message}`))
  }, { capture: true, passive: false })
}

const storage = {
  get(key) { try { return localStorage.getItem(key) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, value) } catch {} },
  remove(key) { try { localStorage.removeItem(key) } catch {} },
}

async function jump(event) {
  const place = locate(event.target, event.clientX, event.clientY)
  if (!place) return toast('Jump to source: this page has no source positions')
  if (place.el) flash(place.el)
  const { el, ...where } = place
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(where) })
  const answer = await res.json()
  if (!res.ok) throw new Error(answer.error ?? res.statusText)
  if (answer.opened) return
  const at = `${answer.file}:${answer.line}:${answer.column}`
  if (!answer.remote) { location.href = `vscode://file${at}`; return }
  if (event.altKey) storage.remove(HOST + answer.host)
  const host = storage.get(HOST + answer.host) ?? await askHost(answer.host)
  if (host) location.href = `vscode://vscode-remote/ssh-remote+${host}${at}`
}

// --- what was clicked -----------------------------------------------------------------------------------------------

// Where the source of what is at (x, y) is, as the endpoint takes it, and the element to flash: the file and either a
// line and column (from 1), or the words clicked, to look for in the file (`text`, with the caret at `offset`) between
// the positions of the marked elements before and after them (`after`, `before`). With a line, the words put the
// column on the word clicked: the page's text is not always the file's (an indent, a backtick, a curly quote).
function locate(target, x, y) {
  const caret = caretAt(x, y)
  for (let el = target instanceof Element ? target : target?.parentElement; el; el = el.parentElement) {
    const loc = el.__svelte_meta?.loc
    if (loc) return { file: loc.file, line: loc.line, column: loc.column + 1, el }
    if (el.hasAttribute('data-src')) {
      const place = markdown(el, caret)
      if (place) return { ...place, ...(caret?.node.parentNode === el ? wordsAt(target, caret) : {}), el }
      break
    }
  }
  // Not written by the MDX itself: a component's output (a table of data, a code block, a slide's title), or the page
  // around the post (its title, its table of contents).
  const marked = [...document.querySelectorAll('[data-src]')]
  const before = marked.find((el) => !el.contains(target) && target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  const after = marked.findLast((el) => el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
  const root = (el) => el?.closest('[data-src-file]')
  const file = root(after) ?? root(before) ?? document.querySelector('[data-src-file]')
  if (!file) return null
  // the start of an element that holds what was clicked, else the end of the one before it
  const inFile = (el, end) => (el && root(el)?.dataset.srcFile === file.dataset.srcFile ? parse(el.dataset.src, end && !el.contains(target)) : undefined)
  const words = wordsAt(target, caret)
  const el = target instanceof Element && !/^(main|body|html)$/.test(target.localName) ? target : null
  return { file: file.dataset.srcFile, version: file.dataset.srcVersion, ...words, after: inFile(after, true), before: inFile(before), skip: between(after, target), el }
}

// The text that the MDX wrote between the element `after` and `target` but did not mark (another component's output,
// such as a slide's notes and the next slide's title), in order: the dev server looks for it first, so that it looks
// for what was clicked after it.
function between(after, target) {
  if (!after || after.contains(target)) return []
  const texts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  walker.currentNode = after
  for (let n = walker.nextNode(); n && !target.contains(n) && target.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING; n = walker.nextNode()) {
    if (after.contains(n) || n.parentElement.closest('[data-src], script, style, template, .katex-mathml')) continue
    if (n.data.trim()) texts.push(n.data.trim().slice(0, 300))
  }
  return texts.slice(-20)
}

// A position, "12:1", or the start or the end of a span, "12:1-14:20".
const parse = (text, end = false) => { const [line, column] = text.split('-')[end ? 1 : 0].split(':').map(Number); return { line, column } }
// The position after `text`, which starts at `start`.
function advance(start, text) {
  const lines = text.split('\n')
  if (lines.length === 1) return { line: start.line, column: start.column + text.length }
  return { line: start.line + lines.length - 1, column: lines.at(-1).length + 1 }
}

// The position of the word at the caret in the element `el` of an MDX file: its text node's start (data-src-text), moved
// over the letters before it. Null when the caret is in an element that the MDX did not write among the element's own
// text (a citation's number, say); otherwise the element's own start (a formula: KaTeX writes all of it).
function markdown(el, caret) {
  const file = el.closest('[data-src-file]')
  const place = { file: file?.dataset.srcFile, version: file?.dataset.srcVersion, ...parse(el.dataset.src) }
  if (!caret || !el.contains(caret.node)) return place
  let child = caret.node
  while (child.parentNode !== el) child = child.parentNode
  if (child.nodeType !== Node.TEXT_NODE) return el.dataset.srcText ? null : place
  const texts = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
  const starts = (el.dataset.srcText ?? '').split(' ').filter(Boolean)
  const start = texts.length === starts.length ? starts[texts.indexOf(child)] : '-'
  return start === '-' ? place : { ...place, ...advance(parse(start), child.data.slice(0, caret.offset)) }
}

// The text around the caret, and where the caret is in it: the line of a code block, or the text node.
function wordsAt(target, caret) {
  const line = target instanceof Element ? target.closest('pre .line') : null
  if (line) {
    const range = document.createRange()
    range.setStart(line, 0)
    if (caret && line.contains(caret.node)) range.setEnd(caret.node, caret.offset)
    else range.collapse(true)
    return { text: line.textContent, offset: range.toString().length }
  }
  if (caret && target.contains?.(caret.node)) return { text: caret.node.data, offset: caret.offset }
  const text = (target.textContent || target.getAttribute?.('alt') || '').slice(0, 300)
  return { text, offset: 0 }
}

// The text node and the offset in it under (x, y), as for a text cursor.
function caretAt(x, y) {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position) return position.offsetNode?.nodeType === Node.TEXT_NODE ? { node: position.offsetNode, offset: position.offset } : null
  const range = document.caretRangeFromPoint?.(x, y)
  return range?.startContainer.nodeType === Node.TEXT_NODE ? { node: range.startContainer, offset: range.startOffset } : null
}

// --- what the page shows --------------------------------------------------------------------------------------------

function flash(el) {
  el.animate([{ outline: '2px solid Highlight', outlineOffset: '2px' }, { outline: '2px solid transparent', outlineOffset: '2px' }], { duration: 900, easing: 'ease-in' })
}

const BOX = 'position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: min(420px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid GrayText; border-radius: 8px; background: Canvas; color: CanvasText; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgb(0 0 0 / 0.25)'

function toast(message) {
  const box = document.createElement('div')
  box.setAttribute('role', 'status')
  box.style.cssText = BOX
  box.textContent = message
  document.body.append(box)
  setTimeout(() => box.remove(), 5000)
}

// Ask which SSH host this browser's VS Code uses for the dev server's machine `server`: one given before, the machine's
// own name, or another. Resolves to the host, or null.
function askHost(server) {
  const known = JSON.parse(storage.get(HOSTS) ?? '[]')
  const choices = [...new Set([...known, server])]
  return new Promise((resolve) => {
    const box = document.createElement('form')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'SSH host for VS Code')
    box.style.cssText = BOX
    const intro = document.createElement('p')
    intro.style.margin = '0 0 8px'
    intro.textContent = `The dev server runs on ${server}, and no VS Code window is connected to it. Which SSH host does VS Code on this computer use for it?`
    const list = document.createElement('div')
    list.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px'
    const other = document.createElement('input')
    other.placeholder = 'Another host (as in ~/.ssh/config)'
    other.style.cssText = 'flex: 1; min-width: 0; font: inherit; padding: 2px 6px'
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 6px'
    const button = (label, onClick, type = 'button') => {
      const b = document.createElement('button')
      b.type = type
      b.textContent = label
      b.style.font = 'inherit'
      if (onClick) b.addEventListener('click', onClick)
      return b
    }
    const done = (host) => {
      box.remove()
      if (host) {
        storage.set(HOST + server, host)
        storage.set(HOSTS, JSON.stringify([host, ...known.filter((h) => h !== host)].slice(0, 8)))
      }
      resolve(host || null)
    }
    for (const host of choices) list.append(button(host, () => done(host)))
    row.append(other, button('Open', null, 'submit'), button('Cancel', () => done(null)))
    box.addEventListener('submit', (event) => { event.preventDefault(); done(other.value.trim()) })
    box.addEventListener('keydown', (event) => { if (event.key === 'Escape') done(null) })
    box.append(intro, list, row)
    document.body.append(box)
    other.focus()
  })
}
