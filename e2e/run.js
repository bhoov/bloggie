// End-to-end test of the built site (`npm run e2e` builds it first). It serves dist/, opens every page in
// headless Chromium, and uses each figure the way a reader would (the figure's own e2e.js, loaded by
// bloggie/e2e/figures.js). It then opens each post's interactive download from disk, as a double click would,
// and checks it the same way, and reads each post's agent download. Each post's table of contents lists its sections,
// and on the example post it is used at a narrow and a wide width (bloggie/e2e/toc.js). Last, it uses the slide editor on a
// copy of the project (bloggie/e2e/editor.js), and saves files under a copy's dev server to see each drawn without a reload
// (the live update, bloggie/e2e/live.js). It fails on any page error, figure that does not hydrate, figure that does not do
// what the post says, editor change that does not reach slides.mdx as it should, or save the page does not show as it should.
//
// Artifact: bloggie/e2e/report/report.json lists every check with what it observed, the browser, the commit,
// and a SHA-256 of each download; bloggie/e2e/report/*.png shows each figure after its check. The checks and
// hashes repeat exactly on a rerun of the same commit (the figures are seeded); only `ranAt` and
// `seconds` change.
import { createHash } from 'node:crypto'
import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch } from './browser.js'
import { checks, afterPage } from './figures.js'
import { editorChecks } from './editor.js'
import { liveChecks } from './live.js'
import { tocList, tocUse, tocSpace } from './toc.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dist = join(root, 'dist')
const reportDir = join(root, 'bloggie/e2e/report')
const started = Date.now()
if (!existsSync(join(dist, 'index.html'))) throw new Error('e2e: dist/ is empty; run `npm run e2e`, which builds first')
rmSync(reportDir, { recursive: true, force: true })
mkdirSync(reportDir, { recursive: true })

// --- a static server for dist/ ---------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  let file = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!file.startsWith(dist) || !existsSync(file)) { res.statusCode = 404; return res.end('not found') }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const site = `http://127.0.0.1:${server.address().port}/`

// --- checks ----------------------------------------------------------------
const results = []
async function check(page, name, fn) {
  try {
    const observed = await fn()
    results.push({ page, check: name, pass: true, observed: observed ?? null })
  } catch (error) {
    results.push({ page, check: name, pass: false, error: error.message })
  }
}

const htmlPages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return htmlPages(path)
  return entry.name === 'index.html' ? [path] : []
})

const hasDeck = (post) => existsSync(join(dist, 'posts', post, 'slides', 'index.html'))
const siteUrl = (await import('../../src/site.js')).site.url

const browser = await launch()
const page = await browser.newPage()

// Load a page and wait until every island has hydrated (Astro removes `ssr` when it does). A post can be longer than
// the tall viewport, and a client:visible island hydrates only once it is seen, so scroll to each one still waiting.
async function open(url) {
  await page.goto(url)
  const islands = await page.evaluate(`document.querySelectorAll('astro-island').length`)
  await page.evaluate(`(async () => {
    for (const el of document.querySelectorAll('astro-island[ssr]')) {
      (el.firstElementChild ?? el.parentElement).scrollIntoView({ block: 'center' })
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    scrollTo(0, 0)
  })()`)
  await page.waitFor(`[...document.querySelectorAll('astro-island')].every((el) => !el.hasAttribute('ssr'))`, { timeout: 30000, what: 'every figure to hydrate' })
  return islands
}
const noProblems = () => { if (page.problems.length) throw new Error(page.problems.join('\n')) }

// Every figure on the open page, then the checks that run after them (afterPage in a figure's e2e.js).
async function figures(label, { screenshots = false } = {}) {
  const names = await page.evaluate(`[...document.querySelectorAll('astro-island')].map((el) => JSON.parse(el.getAttribute('opts')).name)`)
  const shared = {}
  for (const [i, name] of names.entries()) {
    const fn = checks[name]
    await check(label, `figure ${i + 1}: ${name}`, async () => {
      if (!fn) throw new Error(`no check for ${name}: add one to its folder's e2e.js (see bloggie/e2e/figures.js)`)
      // A figure animates only while it is shown (bloggie/lib/visibility.js): on a deck, show its slide.
      const slide = await page.evaluate(`(() => { const s = document.querySelectorAll('astro-island')[${i}].closest('.deck > .slide'); return s ? [...document.querySelectorAll('.deck > .slide')].indexOf(s) + 1 : 0 })()`)
      if (slide) {
        await page.evaluate(`location.hash = '#${slide}'`)
        await page.waitFor(`document.querySelectorAll('.deck > .slide')[${slide - 1}].classList.contains('active')`, { timeout: 5000, what: `slide ${slide} to show` })
      } else {
        // In a post a figure animates only while it is on screen, so scroll to it, as a reader does. An astro-island is
        // display: contents and has no box to scroll to, so scroll to the figure inside it.
        await page.evaluate(`(() => { const el = document.querySelectorAll('astro-island')[${i}]; (el.firstElementChild ?? el).scrollIntoView({ block: 'center' }) })()`)
      }
      // A figure learns that it is on screen from an IntersectionObserver, which reports a frame or more later; a check
      // that presses play before then waits for an animation that never starts.
      await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))`)
      const observed = await fn(page, i, shared).catch(async (error) => {
        // What the page looked like when the check failed: a figure that never moves is often one that is not on screen.
        const state = await page.evaluate(`new Promise((r) => { const el = document.querySelectorAll('astro-island')[${i}]; const box = el.firstElementChild?.getBoundingClientRect(); let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); else new IntersectionObserver(([e], o) => { o.disconnect(); r(JSON.stringify({ intersecting: e.isIntersecting, play: el.querySelector('button[aria-label=play]')?.textContent.trim(), onScreen: [...el.querySelectorAll('[data-on-screen]')].map((x) => x.tagName + '=' + x.dataset.onScreen).join(' '), visibility: document.visibilityState, framesIn500ms: n, top: Math.round(box?.top), bottom: Math.round(box?.bottom), innerHeight, scrollY: Math.round(scrollY), data: Object.fromEntries(Object.entries(el.querySelector('figure')?.dataset ?? {}).slice(0, 12)) })) }).observe(el.querySelector('figure') ?? el) }; requestAnimationFrame(f) })`).catch(() => 'unavailable')
        throw new Error(`${error.message} [page: ${state}]`)
      })
      if (screenshots) {
        const uid = await page.evaluate(`document.querySelectorAll('astro-island')[${i}].getAttribute('uid')`)
        writeFileSync(join(reportDir, `${label.replace(/\W+/g, '-').replace(/^-|-$/g, '')}-figure-${i + 1}.png`), await page.screenshot(`astro-island[uid="${uid}"]`))
      }
      return observed
    })
  }
  for (const [name, fn] of Object.entries(afterPage)) await check(label, name, () => fn(shared))
}

const files = {}
for (const file of htmlPages(dist)) {
  const path = relative(dist, file).replace(/index\.html$/, '')
  const url = new URL(path, site).href
  const label = `/${path}`
  let equations = null // outside figures, plus the figure text the agent download keeps
  await check(label, 'loads, and every figure hydrates, with no errors', async () => {
    const islands = await open(url)
    noProblems()
    equations = await page.evaluate(`[...document.querySelectorAll('.katex')].filter((k) => !k.closest('astro-island') || k.closest('[data-agent-text]')).length`)
    return { figures: islands }
  })
  if (/^posts\//.test(path)) {
    // A figure draws its slide version when it is told medium="slide" (bloggie/lib/slide-headings.js).
    await check(label, 'every figure knows its medium: "slide" in a deck, "blog" in a post', async () => {
      const want = path.endsWith('/slides/') ? 'slide' : 'blog'
      const media = await page.evaluate(`[...document.querySelectorAll('[data-medium]')].map((el) => el.dataset.medium)`)
      const wrong = media.filter((m) => m !== want)
      if (wrong.length) throw new Error(`${wrong.length} of ${media.length} figures say medium="${wrong[0]}"`)
      return `${media.length} figures, medium="${want}"`
    })
  }
  if (/^posts\/[^/]+\/$/.test(path)) {
    // Every section heading ends in a faint # that links to it (Post.astro), for sharing a section.
    await check(label, 'every section heading has an anchor that links to it', async () => {
      const headings = await page.evaluate(`[...document.querySelectorAll('.wrap :is(h2, h3, h4)')].filter((h) => !h.closest('astro-island, .references, .post-list')).map((h) => ({ id: h.id, text: h.textContent.trim(), href: h.querySelector('.heading-anchor')?.getAttribute('href') }))`)
      const bad = headings.filter((h) => !h.id || h.href !== `#${h.id}`)
      if (bad.length) throw new Error(bad.map((h) => `"${h.text}": ${h.id ? `anchor ${h.href ?? 'missing'}` : 'no id'}`).join('; '))
      const last = headings.at(-1)
      if (last) {
        await page.evaluate(`document.querySelector('.wrap [id="${last.id}"] > .heading-anchor').click()`)
        const hash = await page.evaluate('location.hash')
        if (hash !== `#${last.id}`) throw new Error(`clicking the anchor of "${last.text}" gave the URL hash "${hash}"`)
      }
      return `${headings.length} headings`
    })
  }
  if (/^posts\/[^/]+\/slides\/$/.test(path)) {
    // bloggie-slides rule 16: code on a slide is syntax highlighted, and there is no inline code.
    await check(label, 'every code block is syntax highlighted; no inline code', async () => {
      const slides = await page.evaluate(`[...document.querySelectorAll('.deck > .slide')].map((slide) => ({
        title: slide.dataset.title,
        colors: [...slide.querySelectorAll('pre')].filter((pre) => !pre.closest('.demo')).map((pre) => new Set([...pre.querySelectorAll('span[style*="color"]')].map((t) => t.style.color)).size),
        inline: [...slide.querySelectorAll('code')].filter((c) => !c.closest('pre, .demo, aside, table')).map((c) => c.textContent), // a post's table (PostTable) keeps its code
      }))`)
      const bad = slides.filter((s) => s.colors.some((n) => n < 2) || s.inline.length)
      if (bad.length) throw new Error(bad.map((s) => `"${s.title}": ${s.colors.some((n) => n < 2) ? 'a code block in one color' : ''}${s.inline.length ? ` inline code ${s.inline.join(', ')}` : ''}`).join('; '))
      return `${slides.reduce((n, s) => n + s.colors.length, 0)} code blocks`
    })
    await check(label, 'a demo note never covers figure text, with panels open, at any scroll position', async () => {
      const overlaps = await page.evaluate(`(async () => {
        const found = []
        const slides = [...document.querySelectorAll('.deck > .slide')]
        for (const [i, slide] of slides.entries()) {
          const note = slide.querySelector('.demo-note'), demo = slide.querySelector('.demo')
          if (!note || !demo) continue
          location.hash = '#' + (i + 1)
          await new Promise((r) => setTimeout(r, 400))
          demo.querySelectorAll('details').forEach((d) => { d.open = true })
          await new Promise((r) => setTimeout(r, 200))
          const texts = []
          const walker = document.createTreeWalker(demo, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) if (walker.currentNode.textContent.trim() && !note.contains(walker.currentNode)) texts.push(walker.currentNode)
          const max = demo.scrollHeight - demo.clientHeight
          for (let top = 0; top <= max + 59; top += 60) {
            demo.scrollTop = top
            await new Promise((r) => setTimeout(r, 50))
            const n = note.getBoundingClientRect()
            for (const t of texts) {
              const range = document.createRange(); range.selectNodeContents(t)
              for (const r of range.getClientRects()) {
                if (r.width && r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top) { found.push(slide.dataset.title + ' @' + Math.round(top) + ': "' + t.textContent.trim().slice(0, 30) + '"'); break }
              }
            }
          }
          demo.querySelectorAll('details').forEach((d) => { d.open = false })
          demo.scrollTop = 0
        }
        return [...new Set(found)]
      })()`)
      if (overlaps.length) throw new Error(`the note covers ${overlaps.slice(0, 4).join('; ')}`)
      return 'no overlap'
    })
    await check(label, 'a figure never starts by itself, and animates only while its slide is shown', async () => {
      // A deck stacks its slides and hides the inactive ones with opacity and visibility, which an
      // IntersectionObserver does not see (bloggie/lib/visibility.js). The 1D fit tells: it waits at step 0 on its slide
      // until play, stops when its slide is left, and is back at step 0, paused, when its slide is shown again.
      const fit = `document.querySelector('.deck .ef-fig')`
      if (!(await page.evaluate(`!!${fit}`))) return 'no 1D fit on this deck'
      const wait = (ms) => page.evaluate(`new Promise((r) => setTimeout(r, ${ms}))`)
      const step = () => page.evaluate(`${fit}.dataset.step`)
      const slide = await page.evaluate(`[...document.querySelectorAll('.deck > .slide')].indexOf(${fit}.closest('.slide')) + 1`)
      await page.evaluate(`location.hash = '#${slide}'`)
      await wait(1500)
      const unplayed = await step()
      if (unplayed !== '0') throw new Error(`the 1D fit played by itself on its slide, to step ${unplayed}`)
      await page.evaluate(`${fit}.querySelector('button[aria-label="play"]').click()`)
      await page.waitFor(`Number(${fit}.dataset.step) > 0`, { timeout: 10000, what: 'the 1D fit to start when play is pressed' })
      await page.evaluate(`location.hash = '#1'`)
      await wait(300)
      const left = await step()
      await wait(1000)
      const later = await step()
      if (later !== left) throw new Error(`the 1D fit ran from step ${left} to ${later} after its slide was left`)
      await page.evaluate(`location.hash = '#${slide}'`)
      await wait(1500)
      const again = await step()
      if (again !== '0') throw new Error(`back on its slide, the 1D fit is at step ${again}, not at step 0 and paused`)
      await page.evaluate(`location.hash = '#1'`)
      return `step 0 for 1.5 s on slide ${slide} until play; stops at step ${left} when the slide is left; back at step 0, paused, on return`
    })
    await figures(label)
    await check(label, 'no errors while the figures were used', noProblems)
    await check(label, 'presenting: the nav shows only while the mouse is at the bottom; ✕ leaves full screen, then goes back to the post', async () => {
      const deck = await browser.newPage({ width: 1280, height: 800 })
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const move = (x, y) => deck.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      const click = async ([x, y]) => { for (const type of ['mousePressed', 'mouseReleased']) await deck.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 }) }
      try {
        await deck.goto(url)
        await deck.waitFor(`document.querySelector('.deck > .slide.active')`, { timeout: 10000, what: 'the deck' })
        for (const type of ['keyDown', 'keyUp']) await deck.cdp('Input.dispatchKeyEvent', { type, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, text: type === 'keyDown' ? 'f' : undefined })
        await wait(600)
        if (!(await deck.evaluate('!!document.fullscreenElement'))) {
          if (await deck.evaluate('document.fullscreenEnabled')) throw new Error('F did not go full screen')
          return 'this browser has no full screen; not checked'
        }
        const nav = () => deck.evaluate(`getComputedStyle(document.querySelector('.deck-nav')).opacity`)
        const h = await deck.evaluate('innerHeight')
        await move(640, h / 2)
        await wait(300)
        const middle = await nav()
        await move(640, h - 20)
        await wait(300)
        const bottom = await nav()
        await move(640, h / 2)
        await wait(800)
        const away = await nav()
        if (middle !== '0' || bottom === '0' || away !== '0') throw new Error(`the nav's opacity: ${middle} with the mouse in the middle, ${bottom} at the bottom, ${away} after it left`)
        await move(640, h - 20)
        await wait(300)
        const exit = await deck.evaluate(`(() => { const r = document.querySelector('[data-deck="exit"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
        await click(exit)
        await wait(600)
        const after = await deck.evaluate(`({ full: !!document.fullscreenElement, path: location.pathname })`)
        if (after.full || !after.path.endsWith('/slides/')) throw new Error(`after ✕ in full screen: ${JSON.stringify(after)}`)
        await click(exit)
        const post = await deck.waitFor(`!location.pathname.endsWith('/slides/') && location.pathname`, { timeout: 10000, what: '✕ to go back to the post' })
        return `nav ${middle} / ${bottom} / ${away}; ✕: out of full screen, then ${post}`
      } finally {
        await deck.close()
      }
    })
  }
  const post = path.match(/^posts\/([^/]+)\/$/)?.[1]
  if (!post) continue

  // The table of contents (bloggie/lib/toc.js): every post lists its sections; the example post is used as a reader would.
  await check(label, 'the table of contents lists every section, in order, and goes to each', () => tocList(page))
  if (post === 'how-this-blog-works') {
    await tocUse({ check, browser, url, label })
    await tocSpace({ check, browser, url, label })
  }

  await check(label, 'citations are numbered in order of first use', async () => {
    const markers = await page.evaluate(`[...document.querySelectorAll('.citation-marker')].map((m) => m.textContent.trim())`)
    if (!markers.length) return 'no citations'
    const numbers = markers.flatMap((m) => { if (!/^\[\d+(, \d+)*\]$/.test(m)) throw new Error(`a citation marker reads "${m}"`); return m.slice(1, -1).split(', ').map(Number) })
    let highest = 0
    for (const n of numbers) { if (n > highest + 1) throw new Error(`citation [${n}] appears before [${highest + 1}]: ${markers.join(' ')}`); highest = Math.max(highest, n) }
    return markers.join(' ')
  })
  await figures(label, { screenshots: true })
  await check(label, 'no errors while the figures were used', noProblems)

  // The interactive download, opened from disk.
  const download = join(dist, 'posts', post, `${post}.html`)
  const agentFile = join(dist, 'posts', post, `${post}-agent.html`)
  for (const f of [download, agentFile]) if (existsSync(f)) files[relative(dist, f)] = { bytes: statSync(f).size, sha256: createHash('sha256').update(readFileSync(f)).digest('hex') }
  const offline = `${post}.html (from disk)`
  await check(offline, 'opens from file://, and every figure hydrates, with no errors', async () => {
    if (!existsSync(download)) throw new Error(`${download} is missing`)
    const islands = await open(pathToFileURL(download).href)
    noProblems()
    return { figures: islands }
  })
  await check(offline, 'links to the blog go to the live site; Slides opens the deck inside the file', async () => {
    const links = await page.evaluate(`({ index: document.querySelector('.site-nav a')?.href, slides: document.querySelector('[data-slides-link]')?.getAttribute('href') ?? null, download: !!document.querySelector('[data-download]') })`)
    if (!links.index?.startsWith(siteUrl)) throw new Error(`the blog link is ${links.index}, not under ${siteUrl}`)
    if (links.download) throw new Error('the download control is still in the downloaded file')
    if (hasDeck(post) && links.slides !== '#slides') throw new Error(`the Slides link is ${links.slides}, not #slides`)
    return links
  })
  await check(offline, 'the table of contents lists every section, in order, and goes to each', () => tocList(page))
  await figures(offline)
  await check(offline, 'the video plays from inside the file', async () => {
    const state = await page.waitFor(`(() => { const v = document.querySelector('video'); return !v ? 'no video' : v.readyState >= 1 && !v.error ? 'duration ' + v.duration.toFixed(1) + ' s' : '' })()`, { timeout: 20000, what: 'the video to load' })
    return state
  })
  await check(offline, 'no errors while the figures were used', noProblems)
  if (hasDeck(post)) {
    await check(offline, 'S opens the deck inside the file; its figures hydrate and its video plays; Esc closes it', async () => {
      const frame = `document.querySelector('#slides iframe')`
      await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`)
      await page.waitFor(`${frame} && !document.getElementById('slides').hidden`, { timeout: 5000, what: 'the deck frame to open' })
      await page.waitFor(`(() => { const d = ${frame}.contentDocument; const islands = d && [...d.querySelectorAll('astro-island')]; return islands && islands.length && islands.every((el) => !el.hasAttribute('ssr')) })()`, { timeout: 30000, what: 'the deck figures to hydrate' })
      const figures = await page.evaluate(`${frame}.contentDocument.querySelectorAll('astro-island').length`)
      const video = await page.waitFor(`(() => { const v = ${frame}.contentDocument.querySelector('video'); return !v ? 'no video' : v.readyState >= 1 && !v.error ? 'duration ' + v.duration.toFixed(1) + ' s' : '' })()`, { timeout: 20000, what: 'the deck video to load' })
      await page.evaluate(`${frame}.contentDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await page.waitFor(`document.getElementById('slides').hidden`, { timeout: 5000, what: 'Esc to close the deck' })
      noProblems()
      return { figures, video }
    })
  }

  // The agent download: text only, one description per figure, every equation with its TeX.
  await check(`${post}-agent.html`, 'has no scripts, describes every figure, and keeps the TeX of every equation', () => {
    const agent = readFileSync(agentFile, 'utf8')
    const html = readFileSync(file, 'utf8')
    const count = (s, pattern) => (s.match(pattern) ?? []).length
    const islands = count(html, /<astro-island /g)
    const described = count(agent, /<div class="fig-text"><h4>(Figure|Table):/g) // a table figure is described as a table
    const tex = count(agent, /<annotation encoding="application\/x-tex">/g)
    if (/<script/i.test(agent)) throw new Error('the agent download contains a <script>')
    if (/No description\./.test(agent)) throw new Error('a figure has no describe.js')
    if (described !== islands) throw new Error(`${described} figure descriptions for ${islands} figures`)
    if (tex !== equations) throw new Error(`${tex} equations with TeX for ${equations} equations in the post's text`)
    return { figures: described, equations: tex, bytes: agent.length }
  })
}

await page.close()
await browser.close()
server.close()

// The download links under `npm run dev`, which has no built files: the dev server builds them on request.
await check('npm run dev', 'the download links return both files', async () => {
  const post = readdirSync(join(dist, 'posts')).find((slug) => existsSync(join(dist, 'posts', slug, 'index.html')))
  // A dev server of this checkout's own, beside any the author has running (--ignore-lock), so the check
  // tests this code and not an older server's. --ignore-lock also keeps it in this process: run by an
  // agent, `astro dev` otherwise moves to the background, and kill() would not stop it.
  const port = 4900 + Math.floor(Math.random() * 90)
  const dev = spawn(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [dev.stdout, dev.stderr]) stream.on('data', (chunk) => { output += chunk })
  try {
    let origin = null
    for (let i = 0; i < 150 && !origin; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/`)).status) origin = `http://127.0.0.1:${port}` } catch {}
      if (!origin) await new Promise((r) => setTimeout(r, 200))
    }
    if (!origin) throw new Error(`the dev server did not start:\n${output.slice(-500)}`)
    const base = `${origin}${process.env.BASE_PATH || '/'}posts/${post}/`
    const observed = {}
    // Markers every export has: the interactive page's module table, the agent download's opening note.
    for (const [name, marker] of [[`${post}.html`, 'window.__postModules'], [`${post}-agent.html`, '<b>About this file.</b>']]) {
      // The dev server restarts when a source file changes; a dropped connection is retried once.
      const get = () => fetch(base + name).then(async (res) => ({ res, body: await res.text() }))
      const { res, body } = await get().catch(() => new Promise((r) => setTimeout(r, 3000)).then(get)).catch((error) => { throw new Error(`${name}: ${error.cause?.code ?? error.message}`) })
      if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status}: ${body.slice(0, 200)}`)
      if (!/attachment/.test(res.headers.get('content-disposition') ?? '')) throw new Error(`${name} is not sent as a download`)
      if (!body.includes(marker)) throw new Error(`${name} does not contain ${marker}`)
      observed[name] = 'HTTP 200, attachment'
    }
    return observed
  } finally {
    dev.kill()
  }
})

// The slide editor under `npm run dev`, on a copy of the project with its own dev server (bloggie/e2e/editor.js).
await editorChecks({ check, launch, root })
await liveChecks({ check, launch, root })

// --- the artifact ------------------------------------------------------------
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim() } catch { return null } }
const failed = results.filter((r) => !r.pass)
const report = {
  pass: failed.length === 0,
  commit: git('rev-parse HEAD'),
  uncommittedChanges: git('status --porcelain') !== '',
  browser: browser.version,
  checks: results,
  downloads: files,
  ranAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 1000),
}
writeFileSync(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
for (const r of results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.page} · ${r.check}${r.pass ? '' : `\n     ${r.error.replace(/\n/g, '\n     ')}`}`)
console.log(`\ne2e: ${results.length - failed.length}/${results.length} checks passed in ${report.seconds} s; report: ${join(reportDir, 'report.json')}`)
process.exit(failed.length ? 1 : 0)
