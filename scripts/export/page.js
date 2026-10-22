// The interactive download: the built post as one HTML file that opens from disk with working figures.
// Stylesheets, fonts, images, video and data files become inline data; every JavaScript module the page
// loads (the figures, their Svelte renderer, the page's own scripts) is bundled into one inline script.
import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { build } from 'esbuild'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { visit, SKIP } from 'unist-util-visit'
import { dataUri, dist as defaultDist, distAsset, siteLinks } from './common.js'

// Keep only the woff2 source of each @font-face (every current browser reads it), then inline every url().
function inlineCss(file, out) {
  const css = readFileSync(file, 'utf8').replace(/src:([^;}]*)/g, (all, list) => {
    const woff2 = list.split(',').filter((s) => /\.woff2/.test(s))
    return woff2.length ? `src:${woff2.join(',')}` : all
  })
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, url) => {
    const asset = distAsset(url, out)
    return asset ? `url(${dataUri(asset)})` : all
  })
}

// Astro's island element loads a figure's component and renderer with its method importWithRetry(url),
// a dynamic import(). A page opened from disk cannot import files, and browsers differ on importing
// data: URLs there, so the export replaces that method: each island's URLs become keys into the table
// of modules that the inline bundle evaluated.
const MODULE_TABLE = 'window.__postModules = new Promise((resolve) => { window.__resolvePostModules = resolve })'
const LOADER_PATCH = `(() => {
  const island = customElements.get('astro-island')
  if (!island || !island.prototype.importWithRetry) throw new Error('This copy of the post cannot start its figures: the Astro island loader changed.')
  island.prototype.importWithRetry = (key) => window.__postModules.then((modules) => {
    if (!modules[key]) throw new Error('This copy of the post has no module ' + key)
    return modules[key]
  })
})()`
// A long data: URL is a poor video source (some browsers will not seek or play it); a blob: URL made
// from the same bytes plays like a file.
const VIDEO_TO_BLOB = `for (const source of document.querySelectorAll('video source[src^="data:"], video[src^="data:"]')) {
  fetch(source.src).then((response) => response.blob()).then((blob) => {
    source.src = URL.createObjectURL(blob)
    source.closest('video').load()
  }).catch(() => {}) // the data: source stays in place
}`

// The post's deck, carried inside the post's download. The deck page (exported by this same function
// with `inFrame`) is a string in the post; Slides, or S, sets the hash to #slides, which shows the deck
// full-window in an iframe. The iframe is same-origin, so the deck plays the post's video instead of
// a second copy (data-shared-src), and Esc or the deck's ✕ posts 'close-deck' to close it again.
const DECK_HOST = `#slides[hidden] { display: none }
#slides { position: fixed; inset: 0; z-index: 1000; background: #000 }
#slides iframe { width: 100%; height: 100%; border: 0; display: block }`
const DECK_LAUNCHER = `(() => {
  const host = document.getElementById('slides')
  let frame = null
  const shareMedia = () => {
    for (const el of frame.contentDocument.querySelectorAll('[data-shared-src]')) {
      const own = document.querySelector('[data-shared-src="' + el.dataset.sharedSrc + '"]')
      if (!own) continue
      el.src = own.src
      el.closest('video')?.load()
    }
  }
  const open = () => {
    if (!frame) {
      frame = document.createElement('iframe')
      frame.title = 'Slides'
      frame.allow = 'fullscreen'
      frame.addEventListener('load', shareMedia)
      frame.srcdoc = JSON.parse(document.getElementById('deck-source').textContent)
      host.append(frame)
    }
    host.hidden = false
    document.documentElement.style.overflow = 'hidden'
    frame.focus()
  }
  const close = () => {
    host.hidden = true
    document.documentElement.style.overflow = ''
    if (location.hash === '#slides') history.replaceState(null, '', location.pathname + location.search)
    window.focus()
  }
  addEventListener('hashchange', () => (location.hash === '#slides' ? open() : close()))
  addEventListener('message', (event) => { if (frame && event.source === frame.contentWindow && event.data === 'close-deck') close() })
  if (location.hash === '#slides') open()
})()`
// In the frame, before the deck's scripts: the deck keeps its position in the URL hash, which an
// about:srcdoc frame of a file:// page may not change. The deck works without it, so the frame drops
// that call instead of failing on it.
const DECK_HISTORY = `(() => {
  const replace = history.replaceState.bind(history)
  history.replaceState = (...args) => { try { replace(...args) } catch {} }
})()`
// In the frame: the deck has no post URL to go to, so Esc (when the notes are closed and no text field
// has focus) and ✕ ask the post to close the frame. The speaker view needs a second window: hidden.
const DECK_IN_FRAME = `(() => {
  const leave = () => parent.postMessage('close-deck', '*')
  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return
    const notes = document.querySelector('.deck-notes')
    if (notes && !notes.hidden) return
    if (event.target instanceof Element && event.target.closest('textarea, select, [contenteditable], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"])')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    leave()
  }, true)
  addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-deck="exit"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    leave()
  }, true)
})()`

// `out` is the build's output directory; `site` the site's URL, for links back to it (see siteLinks).
// `deck` is the post's deck, already exported with `inFrame: true`, to carry inside this page.
export async function interactivePage(html, { out = defaultDist, site, base, deck, inFrame = false } = {}) {
  const asset = (url) => distAsset(url, out)
  const tree = fromHtml(html)
  siteLinks(tree, { site, base })
  const modules = new Map() // file in dist -> key in the bundle's module table
  const sideEffects = [] // module scripts the page runs for their effects
  const element = (tagName, properties, value) => ({ type: 'element', tagName, properties, children: [{ type: 'text', value }] })
  let head, body, loader = false

  visit(tree, 'element', (node, index, parent) => {
    const p = node.properties
    if (node.tagName === 'head') head = node
    if (node.tagName === 'body') body = node
    if (node.tagName === 'link' && p.rel?.includes('stylesheet')) {
      parent.children[index] = element('style', {}, inlineCss(asset(p.href), out))
      return SKIP
    }
    if (node.tagName === 'link' && asset(p.href)) { parent.children.splice(index, 1); return [SKIP, index] } // preloads
    if (node.tagName === 'script' && p.src) {
      sideEffects.push(asset(p.src))
      parent.children.splice(index, 1)
      return [SKIP, index]
    }
    if (node.tagName === 'script' && !loader && node.children.some((c) => c.type === 'text' && c.value.includes('importWithRetry'))) {
      loader = true
      parent.children.splice(index + 1, 0, element('script', {}, LOADER_PATCH))
      return [SKIP, index + 2]
    }
    if (node.tagName === 'astro-island') {
      // hast keeps these custom attributes under their HTML names.
      for (const attr of ['component-url', 'renderer-url']) {
        if (!p[attr]) continue
        const file = asset(p[attr])
        if (!modules.has(file)) modules.set(file, `post-module:m${modules.size}`)
        p[attr] = modules.get(file)
      }
      if (p['before-hydration-url']) {
        sideEffects.push(asset(p['before-hydration-url']))
        p['before-hydration-url'] = ''
      }
      // A data file that a figure fetches only when the reader asks for it (a model checkpoint, on "Load
      // demo") is in its props as the file's URL: that becomes the file itself, a data: URL, which fetch() reads from
      // a page opened from disk too.
      if (p.props) p.props = p.props.replace(/"([^"]*_astro\/[^"]+)"/g, (all, url) => (asset(url) ? JSON.stringify(dataUri(asset(url))) : all))
    }
    if (inFrame && node.tagName === 'main' && p.dataPost !== undefined) delete p.dataPost
    if (inFrame && p.dataDeck === 'presenter') p.hidden = true
    if (deck && node.tagName === 'a' && p.dataSlidesLink !== undefined) p.href = '#slides'
    // A video: the post keeps its bytes; the deck in the frame borrows them by file name.
    const video = (node.tagName === 'source' || node.tagName === 'video') && asset(p.src)
    if (video) p.dataSharedSrc = basename(video)
    if (video && inFrame) { delete p.src; return }
    for (const attr of ['src', 'poster', 'href']) {
      const file = asset(p[attr])
      if (file) p[attr] = dataUri(file)
    }
  })
  if (modules.size && !loader) throw new Error('export: the page has figures but no Astro island loader with importWithRetry; Astro changed how islands load')

  const names = [...modules.keys()].map((_, i) => `m${i}`)
  const imports = [...modules.keys()].map((file, i) => `import * as ${names[i]} from ${JSON.stringify(file)}`)
  const effects = sideEffects.map((file) => `import ${JSON.stringify(file)}`)
  const table = [...modules.values()].map((key, i) => `${JSON.stringify(key)}: ${names[i]}`)
  const entry = [...effects, ...imports, `window.__resolvePostModules({ ${table.join(', ')} })`].join('\n')
  const bundle = await build({
    stdin: { contents: entry, resolveDir: dirname(sideEffects[0] ?? [...modules.keys()][0] ?? '.'), loader: 'js' },
    bundle: true, format: 'esm', minify: true, write: false, target: 'es2022', logLevel: 'silent',
  })
  const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  head.children.unshift(element('script', {}, MODULE_TABLE))
  body.children.push(element('script', {}, VIDEO_TO_BLOB), element('script', { type: 'module' }, script))
  if (inFrame) {
    head.children.unshift(element('script', {}, DECK_HISTORY))
    body.children.push(element('script', {}, DECK_IN_FRAME))
  }
  if (deck) {
    // JSON with < escaped, so the deck's own </script> tags cannot end this element.
    const source = JSON.stringify(deck).replace(/</g, '\\u003c')
    head.children.push(element('style', {}, DECK_HOST))
    body.children.push(
      { type: 'element', tagName: 'div', properties: { id: 'slides', hidden: true }, children: [] },
      element('script', { type: 'application/json', id: 'deck-source' }, source),
      element('script', {}, DECK_LAUNCHER),
    )
  }

  const page = toHtml(tree, { allowDangerousHtml: true })
  const left = page.indexOf('_astro/')
  if (left >= 0) throw new Error(`export: the interactive page still refers to …${page.slice(left - 40, left + 40)}…`)
  return page
}
