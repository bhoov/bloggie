// The live update's page half, under `npm run dev` only (integration.js injects it into every page).
// On a save, the server tells the page instead of reloading it. The page fetches its new render and swaps
// in only the blocks of <main> that changed. Nothing else moves, so the reader keeps their place, and a
// figure in an unchanged block keeps running. A block that changed is drawn anew, so a figure whose
// props changed starts again with its new props. A change of code that this page runs (a figure's
// .svelte or .js, a layout's script) still reloads the page, as does a change outside <main>; a change
// of code that only other pages run (another post's figure) does not.
//
// The blocks are compared as the server rendered them, before the page's scripts changed them
// (capture.js, taken when the page was parsed): an Astro island counts as its component and its props,
// since what it draws inside is the figure's. The page's own script then enhances the new render as it
// enhanced the page (Post.astro numbers its citations and adds the heading anchors), on the
// `live:render` event, before any block of it goes into the page.
//
// A deck has its own way to draw a change, the slide editor's (bloggie/editor/patch.js), and reloads as before.
import { align } from '../editor/patch.js'
import { capture } from './capture.js'

const main = document.querySelector('main')
if (import.meta.hot && main && !main.matches('.deck')) start(import.meta.hot)

function start(hot) {
  let render = window.__liveRender ?? capture(document)
  delete window.__liveRender
  let busy = false
  let again = false
  hot.on('live:change', async ({ reload = [] } = {}) => {
    if (reload.some(loaded)) { location.reload(); return }
    // One update at a time, each with the newest render: saves that come during one make one more.
    if (busy) { again = true; return }
    busy = true
    try {
      do { again = false; render = await update(render) } while (again)
    } catch (error) {
      console.warn('live update: the page reloads, because', error)
      location.reload()
    } finally {
      busy = false
    }
  })
  // The server sends a reload, not a live:change, to a page that has not said it can draw one.
  hot.send('live:ready')
}

// Whether this page loaded the module at `path` (a URL path, /src/figures/…): each module it imports is a fetch
// that the browser records. The fetch may carry a query (?t=…) and, with a base, a prefix.
function loaded(path) {
  return performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname.endsWith(path))
}

// An island is its component and props; Astro's own inline scripts and styles, which a page needs once,
// are left out.
const ISLAND = ['component-url', 'component-export', 'props', 'opts', 'client']
function key(html) {
  if (!html.includes('<astro-island') && !html.includes('<script')) return html
  return html
    .replace(/<script>([\s\S]*?)<\/script>/g, (whole, code) => (/self\.Astro|astro-island/.test(code) ? '' : whole))
    .replace(/<style>astro-island[\s\S]*?<\/style>/g, '')
    .replace(/<astro-island\b([^>]*)>[\s\S]*?<\/astro-island>/g, (_, attributes) =>
      `<astro-island ${[...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].filter(([, name]) => ISLAND.includes(name)).map(([pair]) => pair).join(' ')}>`)
}

async function update(render) {
  const response = await fetch(location.pathname + location.search, { cache: 'no-store' })
  // A render that failed is Astro's error page: show it, as a reload would. It reloads when the file is fixed.
  if (!response.ok) { location.reload(); return render }
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
  const next = capture(doc)
  if (next.frame !== render.frame || !doc.querySelector('main')) { location.reload(); return render }
  syncHead(doc)
  const was = render.blocks.map(([, html]) => key(html))
  const is = next.blocks.map(([, html]) => key(html))
  if (was.length === is.length && was.every((k, i) => k === is[i])) return render // a save that does not change this page

  document.dispatchEvent(new CustomEvent('live:render', { detail: doc }))
  const freshMain = doc.querySelector('main')
  const live = render.blocks.map(([el]) => el)
  const fresh = next.blocks.map(([el]) => el)
  const onPage = (el) => el?.parentNode === main
  const inRender = (el) => el.parentNode === freshMain // a script may have removed it (Post.astro: the references of a post that cites nothing)
  // The block of the new render that each place holds: the page's own where it is the same, the render's otherwise.
  const blocks = new Array(fresh.length).fill(null)
  const ops = align(was, is)
  for (const { op, a, b } of ops) {
    if (op === 'remove' || !inRender(fresh[b])) continue
    if (op === 'keep' && onPage(live[a])) {
      // A block with a figure stays, so the figure keeps running. Any other block is the render's when
      // the script enhanced it differently (a citation whose number moved).
      blocks[b] = /<astro-island\b/.test(was[a]) || live[a].outerHTML === fresh[b].outerHTML ? live[a] : fresh[b]
    } else blocks[b] = fresh[b]
  }

  // The reader's place: the first block on screen, and where it is.
  const anchor = live.findIndex((el) => onPage(el) && el.getBoundingClientRect().bottom > 0)
  const anchorTop = anchor >= 0 ? live[anchor].getBoundingClientRect().top : 0
  const anchorAt = anchor >= 0 ? placeOf(ops, anchor) : -1

  const kept = new Set(blocks.filter((el) => el?.ownerDocument === document))
  for (const el of live) if (onPage(el) && !kept.has(el)) el.remove()
  // Each new block goes in before the one after it, so a kept block is never moved: an island that is
  // moved starts its figure again.
  let after = null
  for (let b = blocks.length - 1; b >= 0; b--) {
    const el = blocks[b]
    if (!el) continue
    if (!kept.has(el)) {
      main.insertBefore(document.adoptNode(el), after)
      runScripts(el)
    }
    after = el
  }

  const target = anchorAt >= 0 ? blocks.slice(anchorAt).find(Boolean) : null
  if (target) window.scrollBy({ top: target.getBoundingClientRect().top - anchorTop, behavior: 'instant' })
  return { blocks: next.blocks.map(([, html], b) => [blocks[b], html]), frame: next.frame }
}

// The place in the new render of the old block `a`: its own, or for a removed block the next one's.
function placeOf(ops, a) {
  const i = ops.findIndex((o) => o.a === a)
  const at = ops.slice(i).find((o) => o.b !== undefined)
  return at ? at.b : -1
}

// A new figure brings its component's styles (and the modules that update them) into the head.
function syncHead(doc) {
  document.title = doc.title
  for (const meta of doc.head.querySelectorAll('meta[name]')) {
    const own = [...document.head.querySelectorAll('meta[name]')].find((m) => m.name === meta.name)
    if (own) own.content = meta.content
  }
  const styles = new Set([...document.head.querySelectorAll('style[data-vite-dev-id]')].map((s) => s.dataset.viteDevId))
  for (const style of doc.head.querySelectorAll('style[data-vite-dev-id]')) {
    if (!styles.has(style.dataset.viteDevId)) document.head.append(document.importNode(style, true))
  }
  const modules = new Set([...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src')))
  for (const script of doc.head.querySelectorAll('script[type="module"][src]')) {
    if (modules.has(script.getAttribute('src'))) continue
    const copy = document.createElement('script')
    copy.type = 'module'
    copy.src = script.getAttribute('src')
    document.head.append(copy)
  }
}

// A script that arrives in a parsed render does not run: run each inline one the page has not run (an
// island directive, the first time the page has a figure that uses it).
function runScripts(el) {
  const known = new Set([...document.scripts].filter((s) => !el.contains(s)).map((s) => s.textContent))
  for (const script of el.querySelectorAll('script:not([src])')) {
    if (known.has(script.textContent) || (script.type && script.type !== 'text/javascript')) continue
    const copy = document.createElement('script')
    copy.textContent = script.textContent
    document.head.append(copy)
    known.add(script.textContent)
  }
}
