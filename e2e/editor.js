// End-to-end checks of the slide editor (bloggie/editor/), run by bloggie/e2e/run.js. The editor writes
// slides.mdx, so the checks run on a copy of the project with its own dev server: the author's files
// and dev server are not touched. They use the editor as the author does, with real mouse and key
// input, and read the copy's slides.mdx after each step. Then they build the copy, to see that a
// deck the editor changed builds with its styles and that the build has no editor in it.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEdit, outline, readBlock } from '../editor/source.js'

const LABEL = 'slide editor'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Every deck the site serves: a post folder with a slides.mdx, but not one whose name starts with _,
// which Astro does not route (a draft kept out of the site).
const decksIn = (root) => readdirSync(join(root, 'src/pages/posts')).filter((slug) => {
  if (slug.startsWith('_')) return false
  try { return readFileSync(join(root, 'src/pages/posts', slug, 'slides.mdx')) } catch { return false }
})

// The project without .git, dist/, .astro/ (a dev server's lock), the Python environment .venv/ and
// the posts' experiment outputs (_experiments/runs/ and logs/, gigabytes), which no page reads. On
// macOS the copy is a clone, which takes no space; elsewhere a plain copy. The live update's checks
// use it too (bloggie/e2e/live.js).
const SKIP = /^(\.git|dist|\.astro|\.venv|src\/pages\/posts\/[^/]+\/_experiments\/(runs|logs))$/
const DESCEND = /^(src|src\/pages|src\/pages\/posts|src\/pages\/posts\/[^/]+|src\/pages\/posts\/[^/]+\/_experiments)$/
export function copyProject(from, prefix = 'slide-editor-e2e-') {
  const to = mkdtempSync(join(tmpdir(), prefix))
  const copy = (rel) => {
    for (const entry of readdirSync(join(from, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (SKIP.test(path)) continue
      if (entry.isDirectory() && DESCEND.test(path)) { mkdirSync(join(to, path)); copy(path); continue }
      const args = [join(from, path), join(to, path)]
      try { execFileSync('cp', [process.platform === 'darwin' ? '-Rc' : '-R', ...(process.platform === 'darwin' ? [] : ['--reflink=auto']), ...args]) }
      catch { execFileSync('cp', ['-R', ...args]) }
    }
  }
  copy('')
  rmSync(join(to, 'bloggie/e2e/report'), { recursive: true, force: true })
  return to
}

export async function startDev(root) {
  const port = 5000 + Math.floor(Math.random() * 900)
  // --ignore-lock keeps the server in this process: run by an agent, `astro dev` otherwise moves to the
  // background, and kill() would not stop it.
  const dev = spawn(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [dev.stdout, dev.stderr]) stream.on('data', (chunk) => { output += chunk })
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${origin}/`)).status) return { dev, origin } } catch {}
    await sleep(200)
  }
  dev.kill()
  throw new Error(`the copy's dev server did not start:\n${output.slice(-500)}`)
}

// Real input through the DevTools protocol: the editor sees the same events as from a mouse and keyboard.
function inputs(page) {
  const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
  const bits = (mods) => mods.reduce((m, name) => m | MODS[name], 0)
  const mouse = (type, x, y, opts = {}) => page.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...opts })
  return {
    async click(x, y, mods = [], clickCount = 1) {
      const modifiers = bits(mods)
      await mouse('mouseMoved', x, y, { button: 'none', modifiers })
      await mouse('mousePressed', x, y, { buttons: 1, modifiers, clickCount })
      await mouse('mouseReleased', x, y, { modifiers, clickCount })
    },
    async doubleClick(x, y) {
      for (const clickCount of [1, 2]) {
        await mouse('mousePressed', x, y, { buttons: 1, clickCount })
        await mouse('mouseReleased', x, y, { clickCount })
      }
    },
    async drag(x0, y0, x1, y1) {
      await mouse('mouseMoved', x0, y0, { button: 'none' })
      await mouse('mousePressed', x0, y0, { buttons: 1 })
      for (let i = 1; i <= 10; i++) await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, { buttons: 1 })
      await mouse('mouseReleased', x1, y1)
    },
    // A key by its name ('e', 'Enter', 'ArrowDown') or, with `code`, by its place on the keyboard
    // (⌥A types "å", but its code is KeyA).
    async key(key, mods = [], code) {
      const modifiers = bits(mods)
      const named = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, Tab: 9, Delete: 46 }
      const punct = { '.': ['Period', 190], ']': ['BracketRight', 221], '[': ['BracketLeft', 219] }
      const [c, vk] = code ? [code, code.startsWith('Key') ? code.charCodeAt(3) : 0] : named[key] ? [key, named[key]] : punct[key] ?? [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)]
      const text = key === 'Enter' ? '\r' : key.length === 1 && !code && !mods.includes('meta') && !mods.includes('alt') ? key : undefined
      await page.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: c, windowsVirtualKeyCode: vk, modifiers, text })
      await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: c, windowsVirtualKeyCode: vk, modifiers })
    },
  }
}

export async function editorChecks({ check, launch, root }) {
  // Every block of every deck, without a browser: a style (and CSS for an element inside the block)
  // goes on and comes off, and the file is back byte for byte; with it on, the deck has the same
  // slides and blocks.
  await check(LABEL, 'every block of every deck takes a style and inner CSS, and their undo gives the file back byte for byte', () => {
    const observed = {}
    for (const slug of decksIn(root)) {
      const source = readFileSync(join(root, 'src/pages/posts', slug, 'slides.mdx'), 'utf8')
      // The deck's shape: each slide's kind and blocks (an outline's hashes change with any edit).
      const shapeOf = (text) => JSON.stringify(outline(text).slides.map((s) => [s.kind, s.blocks]))
      const shape = shapeOf(source)
      const ids = outline(source).slides.flatMap((s, i) => [`${i}/t`, ...s.blocks])
      for (const id of ids) {
        const edits = [{ type: 'style', set: { translate: '3px 4px', 'font-size': '41px' }, read: (text) => readBlock(text, id).style, expect: ['translate: 3px 4px', 'font-size: 41px'] }]
        if (!id.endsWith('/t')) edits.push({ type: 'inner', selector: 'span.e2e:nth-of-type(2)', set: { color: 'red' }, read: (text) => readBlock(text, id).inner, expect: ['span.e2e:nth-of-type(2) { color: red }'] })
        for (const { type, selector, set, read, expect } of edits) {
          const { source: on, inverse } = applyEdit(source, { type, id, selector, set })
          if (!expect.every((e) => read(on).includes(e))) throw new Error(`${slug} ${id}: ${type} reads "${read(on)}"`)
          if (shapeOf(on) !== shape) throw new Error(`${slug} ${id}: a ${type} edit changed the deck's slides or blocks`)
          // The edit that undoes it puts back what the block had (the author's own style, if any).
          if (applyEdit(on, inverse).source !== source) throw new Error(`${slug} ${id}: undoing the ${type} edit did not restore the file`)
        }
      }
      observed[slug] = `${ids.length} blocks and titles`
    }
    return observed
  })

  const copy = copyProject(root)
  let dev = null
  let browser = null
  try {
    const started = await startDev(copy)
    dev = started.dev
    browser = await launch()
    const page = await browser.newPage({ width: 1400, height: 900 })
    const { click, doubleClick, drag, key } = inputs(page)
    const ev = (js) => page.evaluate(js)
    const deckFile = join(copy, 'src/pages/posts/how-this-blog-works/slides.mdx')
    const read = () => readFileSync(deckFile, 'utf8')
    const original = read()
    const center = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const box = getComputedStyle(el).display === 'contents' ? el.firstElementChild : el; const r = box.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const box = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width } })()`)
    const saved = () => page.waitFor(`document.querySelector('.se-status')?.textContent === 'Saved'`, { timeout: 8000, what: 'the editor to say Saved' })
    const editing = () => page.waitFor(`document.readyState === 'complete' && document.body?.classList.contains('se-on') && !!document.querySelector('.se-toolbar')`, { timeout: 20000, what: 'edit mode' })
    // An edit of text, blocks or slides is drawn in place (patch.js): wait for its last status, and
    // fail if the page reloaded. The status is cleared first, so that an earlier "Saved" does not count.
    const drawn = async (action) => {
      await ev(`document.querySelector('.se-status').textContent = ''`)
      await action()
      await page.waitFor(`['Saved', 'Undone', 'Redone'].includes(document.querySelector('.se-status')?.textContent)`, { timeout: 20000, what: 'the change to be drawn' })
      await sleep(300)
      if (!(await ev(`window.__stay`))) throw new Error('the page reloaded')
    }
    const what = () => ev(`document.querySelector('.se-what').textContent`)
    const at = () => ev(`[...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.classList.contains('active')) + 1`)
    const open = async (url) => {
      await page.goto(url)
      await page.waitFor(`document.querySelector('.deck .slide.active') && document.querySelector('.se-toggle')`, { timeout: 30000, what: 'the deck and its Edit button' })
    }
    const undoAll = async () => {
      for (let i = 0; i < 12 && read() !== original; i++) { await key('z', ['meta']); await sleep(700) }
      if (read() !== original) throw new Error('undo did not bring slides.mdx back')
    }
    // Each check starts from the original deck: a check that fails leaves its edit, which the next undoes.
    const restore = async () => {
      if (read() === original) return
      writeFileSync(deckFile, original)
      await sleep(600) // for the dev server to see the file
      await page.evaluate(`location.reload()`)
      await sleep(500)
      await editing()
      await ev(`window.__stay = 1`)
    }
    const step = (name, fn) => check(LABEL, name, async () => { await restore(); return fn() })
    // A click on the slide's background (its bottom right corner) selects nothing.
    const clickBackground = async () => {
      const d = await box('.deck')
      await click(d.right - 12, d.top + 12)
    }

    await check(LABEL, 'E turns editing on, and on every deck the page\'s blocks are the ones in slides.mdx', async () => {
      const observed = {}
      for (const slug of decksIn(copy)) {
        await open(`${started.origin}/posts/${slug}/slides/#1`)
        await key('e')
        await editing()
        await sleep(200)
        const state = await ev(`({ blocked: document.querySelector('.se-toolbar').classList.contains('se-blocked'), status: document.querySelector('.se-status').textContent, blocks: document.querySelectorAll('.deck [data-edit]').length })`)
        if (state.blocked) throw new Error(`${slug}: ${state.status}`)
        observed[slug] = `${state.blocks} blocks and titles`
        await key('e')
      }
      if (page.problems.length) throw new Error(page.problems.join('\n'))
      return observed
    })

    // The first text slide with a paragraph, in the example deck.
    await open(`${started.origin}/posts/how-this-blog-works/slides/#1`)
    const target = await ev(`(() => { const p = document.querySelector('.deck > .slide.text .slide-body > p[data-edit]'); return { id: p.dataset.edit, slide: Number(p.dataset.edit.split('/')[0]) + 1 } })()`)
    const paragraph = `.deck [data-edit="${target.id}"]`
    const title = `.deck [data-edit="${target.slide - 1}/t"]`
    await ev(`location.hash = '#${target.slide}'`)
    await key('e')
    await editing()
    await ev(`window.__stay = 1`)

    await step('the slide list has every slide; its thumbnail of the shown slide is marked, and holds no live figure', async () => {
      const state = await ev(`({ thumbs: document.querySelectorAll('.se-panel .se-slide').length, slides: document.querySelectorAll('.deck > .slide').length, current: document.querySelector('.se-slide.se-current')?.dataset.index, islands: document.querySelectorAll('.se-panel astro-island').length, drawn: document.querySelectorAll('.se-slide-stage > .slide').length })`)
      if (state.thumbs !== state.slides) throw new Error(`${state.thumbs} thumbnails for ${state.slides} slides`)
      if (Number(state.current) !== target.slide - 1) throw new Error(`thumbnail ${state.current} is marked, on slide ${target.slide}`)
      if (state.islands) throw new Error(`the thumbnails hold ${state.islands} islands`)
      if (!state.drawn) throw new Error('no thumbnail is drawn')
      return state
    })

    await step('a dragged paragraph is written as a <Box> with a translate, and the page does not reload', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      await drag(p.x, p.y, p.x + 70, p.y - 35)
      await saved()
      const text = readBlock(read(), target.id).text
      const found = read().match(new RegExp(`<Box style="translate: (-?\\d+)px (-?\\d+)px">\\n${escape(text)}\\n</Box>`))
      if (!found) throw new Error(`slides.mdx has no <Box> with a translate around "${text.slice(0, 40)}"`)
      if (!(await ev(`window.__stay`))) throw new Error('the page reloaded')
      const inPage = await ev(`document.querySelector(${JSON.stringify(paragraph)}).style.translate`)
      if (inPage !== `${found[1]}px ${found[2]}px`) throw new Error(`the page shows translate "${inPage}", the file ${found[0]}`)
      return `translate: ${found[1]}px ${found[2]}px, in the file and the page`
    })

    await step('⌘⇧> twice and ⌘B are written to the Box; undo brings slides.mdx back byte for byte', async () => {
      const size = await ev(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(paragraph)})).fontSize)`)
      await key('.', ['meta', 'shift'])
      await key('.', ['meta', 'shift'])
      await key('b', ['meta'])
      await sleep(700)
      await saved()
      const style = readBlock(read(), target.id).style
      if (!style.includes(`font-size: ${size + 4}px`) || !style.includes('font-weight: 700')) throw new Error(`the Box's style is "${style}"`)
      await undoAll()
      const left = await ev(`document.querySelector(${JSON.stringify(paragraph)}).getAttribute('style')`)
      if (left) throw new Error(`the page still has style="${left}" after undo`)
      if (!(await ev(`window.__stay`))) throw new Error('the page reloaded')
      return `${style}; undone, and the file is the original`
    })

    await step('a side handle widens a paragraph past its stylesheet max-width', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      const before = await box(paragraph)
      const handle = await center('.se-handle[data-handle="e"]')
      await drag(handle.x, handle.y, handle.x + 120, handle.y)
      await saved()
      const after = await box(paragraph)
      const style = readBlock(read(), target.id).style
      if (after.width < before.width + 110) throw new Error(`dragged 120 px, the paragraph grew ${Math.round(after.width - before.width)} px (${style})`)
      if (Math.abs(after.left - before.left) > 1) throw new Error(`its left edge moved ${after.left - before.left} px`)
      await undoAll()
      return `${Math.round(before.width)} → ${Math.round(after.width)} px on screen; ${style}`
    })

    await step('a title\'s size is written to its heading tag, and the server renders it the same after a reload', async () => {
      const t = await center(title)
      await click(t.x, t.y)
      const size = await ev(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(title)})).fontSize)`)
      await key('.', ['meta', 'shift'])
      await sleep(700)
      await saved()
      const line = read().split('\n').find((l) => l.includes(`titleStyle="font-size: ${size + 2}px"`))
      if (!line?.startsWith('## [text titleStyle=')) throw new Error(`no heading tag with the new size; the heading reads ${line}`)
      await page.evaluate(`location.reload()`)
      await sleep(500)
      await editing()
      const after = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(title)})).fontSize`)
      if (after !== `${size + 2}px`) throw new Error(`after a reload the title is ${after}`)
      const label = await ev(`document.querySelectorAll('.deck > .slide')[${target.slide - 1}].dataset.title`)
      if (/titleStyle|\[/.test(label)) throw new Error(`the tag leaked into the slide's title: "${label}"`)
      await ev(`window.__stay = 1`)
      await undoAll()
      return `${line}; ${after} after a reload`
    })

    await step('Shift+click selects two blocks; ⌥A aligns their left edges, in one step to undo', async () => {
      const t = await center(title)
      const p = await center(paragraph)
      await click(t.x, t.y)
      // Move the paragraph off its line first, then align.
      await click(p.x, p.y)
      await key('ArrowRight', ['shift'])
      await key('ArrowRight', ['shift'])
      await key('ArrowRight', ['shift'])
      await sleep(700)
      await saved()
      await click(t.x, t.y)
      await click(p.x, p.y, ['shift'])
      if (!/2 blocks/.test(await what())) throw new Error(`the selection reads "${await what()}"`)
      await key('å', ['alt'], 'KeyA')
      await saved()
      const [a, b] = [await box(title), await box(paragraph)]
      if (Math.abs(a.left - b.left) > 1.5) throw new Error(`the left edges are ${a.left} and ${b.left}`)
      await key('z', ['meta'])
      await sleep(700)
      const style = readBlock(read(), target.id).style
      if (style !== 'translate: 30px 0px') throw new Error(`one undo left "${style}", not the nudged paragraph`)
      await undoAll()
      return `left edges ${Math.round(a.left)} and ${Math.round(b.left)}; one undo returns the nudge`
    })

    await step('⌘[ sends a block backward (z-index); the slide keeps it in view', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      await key('[', ['meta'])
      await saved()
      const style = readBlock(read(), target.id).style
      if (style !== 'z-index: -1') throw new Error(`the Box's style is "${style}"`)
      // Above its slide's background (the slide isolates its layers), and still selected by a click.
      const order = await ev(`(() => { const all = document.elementsFromPoint(${p.x}, ${p.y}); return [all.findIndex((el) => el.matches(${JSON.stringify(paragraph)})), all.findIndex((el) => el.matches('.deck > .slide'))] })()`)
      if (order[0] < 0 || order[0] > order[1]) throw new Error(`at its center the paragraph is layer ${order[0]} and its slide ${order[1]}`)
      await clickBackground()
      await click(p.x, p.y)
      if (!/· Paragraph$/.test(await what())) throw new Error(`a click on it selects "${await what()}"`)
      await undoAll()
      return `${style}; above its slide, and a click selects it`
    })

    await step('⌘+click selects an element inside a block; its CSS goes to the Box\'s inner rules and nothing else changes', async () => {
      const strong = `${paragraph} strong`
      const s = await center(strong)
      await click(s.x, s.y, ['meta'])
      await sleep(300)
      if (!/› strong/.test(await what())) throw new Error(`the selection reads "${await what()}"`)
      const sizes = () => ev(`[getComputedStyle(document.querySelector(${JSON.stringify(strong)})).fontSize, getComputedStyle(document.querySelector(${JSON.stringify(paragraph)})).fontSize]`)
      const [before, rest] = await sizes()
      await key('.', ['meta', 'shift'])
      await sleep(700)
      await saved()
      const inner = readBlock(read(), target.id).inner
      if (inner !== `strong { font-size: ${parseFloat(before) + 2}px }`) throw new Error(`the Box's inner is "${inner}"`)
      const [now, restNow] = await sizes()
      if (now !== `${parseFloat(before) + 2}px` || restNow !== rest) throw new Error(`the page shows the strong at ${now} and the paragraph at ${restNow}`)
      await page.evaluate(`location.reload()`)
      await sleep(500)
      await editing()
      const [served] = await sizes()
      if (served !== now) throw new Error(`after a reload the strong is ${served}`)
      await ev(`window.__stay = 1`)
      // Esc goes out one level at a time, and out of editing, but never out of the deck.
      const s2 = await center(strong)
      await click(s2.x, s2.y, ['meta'])
      await sleep(300)
      await key('Escape')
      const up = await what()
      await key('Escape')
      const none = await what()
      await key('Escape')
      const state = await ev(`({ editing: document.body.classList.contains('se-on'), path: location.pathname })`)
      if (!/· Paragraph$/.test(up) || /·/.test(none) || state.editing || !state.path.endsWith('/slides/')) throw new Error(`Esc: "${up}", then "${none}", then ${JSON.stringify(state)}`)
      await key('e')
      await editing()
      await undoAll()
      return `${inner}; the paragraph stays ${rest}; Esc: block, nothing, editing off`
    })

    await step('with no block selected the arrows move the deck; with one they move the block', async () => {
      await clickBackground()
      await key('ArrowRight')
      await sleep(400)
      if ((await at()) !== target.slide + 1) throw new Error(`ArrowRight with nothing selected shows slide ${await at()}`)
      await key('ArrowLeft')
      await sleep(400)
      const p = await center(paragraph)
      await click(p.x, p.y)
      await key('ArrowDown', ['shift'])
      await key('ArrowDown', ['shift'])
      await key('ArrowRight')
      await sleep(700)
      await saved()
      if ((await at()) !== target.slide) throw new Error(`the arrows moved the deck to slide ${await at()}`)
      const style = readBlock(read(), target.id).style
      if (style !== 'translate: 1px 20px') throw new Error(`the nudges wrote "${style}"`)
      await undoAll()
      return `slide ${target.slide + 1} on ArrowRight; ${style} with the block selected`
    })

    await step('Markdown edited in place: ⌘B wraps the selection in **, ⌘Enter saves, and the page draws it bold without a reload', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      await key('Enter')
      await page.waitFor(`document.querySelector('.se-source textarea')`, { timeout: 5000, what: 'the Markdown editor' })
      await ev(`(() => { const a = document.querySelector('.se-source textarea'); a.value = 'Edited in place.'; a.setSelectionRange(7, 15) })()`)
      await key('b', ['meta'])
      const value = await ev(`document.querySelector('.se-source textarea').value`)
      if (value !== 'Edited **in place**.') throw new Error(`⌘B made "${value}"`)
      await drawn(() => key('Enter', ['meta']))
      const shown = await ev(`document.querySelector(${JSON.stringify(paragraph)}).innerHTML`)
      if (!shown.includes('<strong>in place</strong>') || !read().includes('Edited **in place**.')) throw new Error(`the page shows "${shown}"`)
      await drawn(() => key('z', ['meta']))
      if (read() !== original) throw new Error('undo did not bring slides.mdx back')
      return `"${value}" written, rendered as ${shown}, and undone, in place`
    })

    await step('⌘D copies a list as a list of its own, and undo removes the copy', async () => {
      const index = await ev(`[...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.querySelector('.slide-body > ul[data-edit]'))`)
      await ev(`location.hash = '#${index + 1}'`)
      await sleep(500)
      const list = await ev(`document.querySelectorAll('.deck > .slide')[${index}].querySelector('.slide-body > ul[data-edit]').dataset.edit`)
      const before = outline(read()).slides[index].blocks.length
      const l = await center(`.deck [data-edit="${list}"]`)
      await click(l.x, l.y)
      await drawn(() => key('d', ['meta']))
      const after = outline(read()).slides[index].blocks.length
      if (after !== before + 1) throw new Error(`slide ${index + 1} has ${after} blocks, not ${before + 1}`)
      const selected = await what()
      await drawn(() => key('z', ['meta']))
      if (read() !== original) throw new Error('undo did not bring slides.mdx back')
      return `slide ${index + 1}: ${before} → ${after} blocks; "${selected}" selected`
    })

    await step('Option+click uses a figure as a reader does; a plain click selects it', async () => {
      const index = await ev(`[...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.querySelector('astro-island[data-edit] .fig-play'))`)
      await ev(`location.hash = '#${index + 1}'`)
      await sleep(600)
      const play = `.deck > .slide.active .fig-play`
      const b = await center(play)
      const titleOf = () => ev(`document.querySelector(${JSON.stringify(play)}).title`)
      const before = await titleOf()
      await click(b.x, b.y)
      await sleep(300)
      const plain = [await titleOf(), await what()]
      await click(b.x, b.y, ['alt'])
      await sleep(300)
      const option = await titleOf()
      if (plain[0] !== before || !/· Figure$/.test(plain[1])) throw new Error(`a plain click: button "${plain[0]}", selection "${plain[1]}"`)
      if (option === before) throw new Error(`Option+click left the button at "${option}"`)
      await click(b.x, b.y, ['alt']) // pause it again
      return `plain click: "${before}", figure selected; Option+click: "${option}"`
    })

    await step('double-click goes inside a figure: an element\'s CSS wraps the figure in a Box with inner rules, drawn in place; undo removes it', async () => {
      const index = await at()
      const island = await ev(`document.querySelector('.deck > .slide.active astro-island[data-edit]').dataset.edit`)
      const label = `.deck > .slide.active [data-edit="${island}"] .fig-play`
      const b = await center(label)
      await doubleClick(b.x, b.y)
      await sleep(400)
      if (!/Figure › button/.test(await what())) throw new Error(`the selection reads "${await what()}"`)
      const size = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(label)})).fontSize`)
      await drawn(() => key('.', ['meta', 'shift']))
      await page.waitFor(`[...document.querySelectorAll('.deck astro-island')].every((el) => !el.hasAttribute('ssr'))`, { timeout: 20000, what: 'the figure to hydrate again' })
      const inner = readBlock(read(), island).inner
      const shown = await ev(`getComputedStyle(document.querySelector('.deck > .slide.active .fig-play')).fontSize`)
      if (!/^astro-island > .* button\.fig-play \{ font-size: \d+px \}$/.test(inner) || parseFloat(shown) !== Math.round(parseFloat(size)) + 2) throw new Error(`inner "${inner}", the button at ${shown} (was ${size})`)
      if (!(await ev(`!!document.querySelector('.deck > .slide.active div.slide-box style[data-box], .deck > .slide.active style[data-box]')`))) throw new Error('no <style data-box> for the rules')
      await drawn(() => key('z', ['meta']))
      if (read() !== original) throw new Error('undo did not bring slides.mdx back')
      return `slide ${index}: ${inner}`
    })

    await step('the slide list: a thumbnail shows its slide; there ⌘D duplicates it and Delete deletes it, in place', async () => {
      const count = outline(original).slides.length
      await ev(`document.querySelector('.se-slide[data-index="1"]').scrollIntoView({ block: 'center' })`)
      await sleep(200)
      const t = await center('.se-slide[data-index="1"] .se-slide-frame')
      await click(t.x, t.y)
      await sleep(500)
      if ((await at()) !== 2) throw new Error(`the thumbnail of slide 2 shows slide ${await at()}`)
      await drawn(() => key('d', ['meta']))
      const copied = outline(read()).slides.length
      const now = await at()
      const thumbs = await ev(`document.querySelectorAll('.se-panel .se-slide').length`)
      await drawn(() => key('Delete'))
      if (thumbs !== count + 1) throw new Error(`${thumbs} thumbnails for ${count + 1} slides`)
      if (copied !== count + 1 || now !== 3) throw new Error(`after ⌘D: ${copied} slides (not ${count + 1}), on slide ${now}`)
      if (read() !== original) throw new Error('Delete on the copy did not bring slides.mdx back')
      return `${count} → ${copied} → ${count} slides; the copy was shown as slide ${now}`
    })

    await step('Delete and its undo are drawn in place, and a figure on another slide keeps running', async () => {
      const demo = await ev(`[...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.querySelector('astro-island[data-edit] .fig-play'))`)
      const figure = `.deck > .slide:nth-child(${demo + 1}) astro-island`
      await ev(`location.hash = '#${demo + 1}'`)
      await sleep(600)
      const play = await center(`.deck > .slide.active .fig-play`)
      await click(play.x, play.y, ['alt'])
      await ev(`document.querySelectorAll('.deck > .slide')[${demo}].querySelector('astro-island').__e2e = 'live'`)
      await ev(`location.hash = '#${target.slide}'`)
      await sleep(600)
      const p = await center(paragraph)
      await click(p.x, p.y)
      const text = readBlock(original, target.id).text
      await drawn(() => key('Delete'))
      if (read().includes(text) || (await ev(`!!document.querySelector(${JSON.stringify(paragraph)})`))) throw new Error('the paragraph is still in the file or the page')
      await drawn(() => key('z', ['meta']))
      if (read() !== original) throw new Error('undo did not bring slides.mdx back')
      const live = await ev(`(() => { const island = document.querySelectorAll('.deck > .slide')[${demo}].querySelector('astro-island'); return { same: island.__e2e === 'live', button: island.querySelector('.fig-play').title } })()`)
      if (!live.same || live.button !== 'Pause') throw new Error(`the figure on slide ${demo + 1}: ${JSON.stringify(live)}`)
      await ev(`location.hash = '#${demo + 1}'`)
      await sleep(500)
      await click(play.x, play.y, ['alt']) // pause it again
      await ev(`location.hash = '#${target.slide}'`)
      await sleep(500)
      return `the paragraph went and came back; the figure on slide ${demo + 1} is the same element, still playing`
    })

    await step('double-click selects words on the slide; a color, ⌘B and the eyedropper style only them, in place; bold keeps a color', async () => {
      // The first three words of the paragraph's own text (outside its bold or other elements), by where they are on the
      // screen. They can be in several text nodes: "Ask for **…** with the …".
      const spots = await ev(`(() => {
        const texts = [...document.querySelector(${JSON.stringify(paragraph)}).childNodes].filter((n) => n.nodeType === 3)
        return texts.flatMap((t) => [...t.data.matchAll(/[A-Za-z]{3,}/g)].map((m) => [t, m])).slice(0, 3).map(([t, m]) => { const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); const b = r.getBoundingClientRect(); return { word: m[0], x: b.left + b.width / 2, y: b.top + b.height / 2 } })
      })()`)
      if (spots.length < 3) throw new Error('the paragraph has not three words to style')
      const [one, two, three] = spots
      await doubleClick(one.x, one.y)
      await sleep(300)
      const picked = await ev(`getSelection().toString()`)
      if (picked !== one.word || !/· words$/.test(await what())) throw new Error(`a double-click on "${one.word}" selected "${picked}" (${await what()})`)
      await ev(`document.querySelector('[data-act="palette"]').click()`)
      await drawn(() => ev(`document.querySelector('.se-palette [data-value="var(--series-2)"]').click()`))
      if (!read().includes(`<span style="color: var(--series-2)">${one.word}</span>`)) throw new Error(`no colored "${one.word}" in slides.mdx`)
      const colored = await ev(`[...document.querySelectorAll(${JSON.stringify(paragraph + ' span')})].map((s) => s.textContent + ':' + s.style.color).join()`)
      // The next two words: selected by hand, as a drag selects them.
      const selectWord = (w) => ev(`(() => { const p = document.querySelector(${JSON.stringify(paragraph)}); const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); for (let t = walker.nextNode(); t; t = walker.nextNode()) { const i = t.data.search(new RegExp('\\\\b' + ${JSON.stringify(w)} + '\\\\b')); if (i >= 0 && (${JSON.stringify(w)} === ${JSON.stringify(one.word)} || !t.parentElement.closest('span, strong'))) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + ${w.length}); getSelection().removeAllRanges(); getSelection().addRange(r); return true } } return false })()`)
      if (!(await selectWord(two.word))) throw new Error(`"${two.word}" is not in the redrawn paragraph`)
      // The bold shows at once, ahead of the server's render of the block, which is held back here.
      await ev(`(() => { const f = window.fetch; window.__held = []; window.__fetch = f; window.fetch = (...a) => (String(a[0]).includes('__slide-editor') ? f(...a) : new Promise((go) => window.__held.push(() => go(f(...a))))) })()`)
      await drawn(async () => {
        await key('b', ['meta'])
        const early = await page.waitFor(`window.__held.length && [...document.querySelectorAll(${JSON.stringify(paragraph + ' strong')})].some((s) => s.textContent === ${JSON.stringify(two.word)}) && document.querySelector('.se-status').textContent`, { timeout: 5000, what: `"${two.word}" bold on the page while its render is held back` })
        if (!['Saving…', 'Drawing…'].includes(early)) throw new Error(`with the render held back, the status is "${early}"`)
        await ev(`window.fetch = window.__fetch; window.__held.splice(0).forEach((go) => go())`)
      })
      if (!read().includes(`**${two.word}**`)) throw new Error(`no **${two.word}** in slides.mdx`)
      // Bold on the colored word: it keeps its color (slides.css gives bold primary ink otherwise).
      if (!(await selectWord(one.word))) throw new Error(`"${one.word}" is not in the redrawn paragraph`)
      await drawn(() => key('b', ['meta']))
      const inks = await ev(`(() => { const s = [...document.querySelectorAll(${JSON.stringify(paragraph + ' strong')})].find((el) => el.textContent === ${JSON.stringify(one.word)}); const span = s?.closest('span[style]') ?? s?.querySelector('span[style]'); return s && span ? [getComputedStyle(s).color, getComputedStyle(span).color] : null })()`)
      if (!inks || inks[0] !== inks[1]) throw new Error(`the bold colored word is ${inks?.[0]}, its color ${inks?.[1]}`)
      // The eyedropper: over the colored word, the loupe names the theme color; a click gives it to
      // the selected words, by the theme's name, and keeps it among the recent colors.
      if (!(await selectWord(three.word))) throw new Error(`"${three.word}" is not in the redrawn paragraph`)
      await ev(`document.querySelector('[data-act="eyedrop"]').click()`)
      const over = await ev(`(() => { const s = [...document.querySelectorAll(${JSON.stringify(paragraph + ' strong')})].find((el) => el.textContent === ${JSON.stringify(one.word)}); const b = s.getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height / 2 } })()`)
      await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: over.x, y: over.y, button: 'none' })
      await sleep(150)
      const loupe = await ev(`({ layer: !!document.querySelector('.se-eyedrop'), name: document.querySelector('.se-loupe-name')?.textContent })`)
      if (!loupe.layer || !/^series-2 · #/.test(loupe.name)) throw new Error(`picking: ${JSON.stringify(loupe)}`)
      await drawn(() => click(over.x, over.y))
      if (!read().includes(`<span style="color: var(--series-2)">${three.word}</span>`)) throw new Error(`no "${three.word}" colored var(--series-2) in slides.mdx`)
      const recent = await ev(`JSON.parse(localStorage.getItem('slide-editor:colors'))[0]`)
      if (recent !== 'var(--series-2)') throw new Error(`the recent colors start with ${recent}`)
      const line = read().split('\n').find((l) => l.includes(`**${two.word}**`))
      await ev(`document.activeElement?.blur()`)
      await undoAll()
      return `${line.slice(0, 120)}; in the page: ${colored}`
    })

    await step('the font menu writes a theme font; the size box has no spinner; the opacity slider writes a color with an opacity, once, for a block and for selected words, and a swatch keeps it', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      await sleep(200)
      // With no font of its own, the menu names the font the paragraph has from the page.
      const menu = await ev(`document.querySelector('.se-font').selectedOptions[0].textContent`)
      if (!/^Default \((Sans|Serif|Mono)\)$/.test(menu)) throw new Error(`with no font of its own, the font menu shows "${menu}"`)
      await ev(`(() => { const s = document.querySelector('.se-font'); s.value = 'var(--serif)'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await saved()
      const font = readBlock(read(), target.id).style
      const inSerif = await ev(`(() => { const probe = document.createElement('span'); probe.style.fontFamily = 'var(--serif)'; document.body.append(probe); const want = getComputedStyle(probe).fontFamily; probe.remove(); return getComputedStyle(document.querySelector(${JSON.stringify(paragraph)})).fontFamily === want })()`)
      if (font !== 'font-family: var(--serif)' || !inSerif) throw new Error(`the font menu wrote "${font}"; the paragraph drawn in the serif: ${inSerif}`)
      const appearance = await ev(`getComputedStyle(document.querySelector('.se-size')).appearance`)
      if (appearance !== 'textfield') throw new Error(`the size box's appearance is "${appearance}", which shows a spinner`)
      const palette = () => ev(`document.querySelector('.se-palette').hidden && document.querySelector('[data-act="palette"]').click()`)
      const status = () => ev(`document.querySelector('.se-status').textContent = ''`)
      // The slider, pressed at its right end (100%), then the left arrow down to `to`.
      const slide = async (to) => {
        const [c, b] = [await center('.se-opacity input'), await box('.se-opacity input')]
        await click(b.right - 5, c.y)
        const from = Number(await ev(`document.querySelector('.se-opacity input').value`))
        for (let i = 0; i < (from - to) / 5; i++) await key('ArrowLeft')
        return from
      }
      await palette()
      await ev(`document.querySelector('.se-palette [data-value="var(--series-2)"]').click()`)
      await saved()
      await status()
      await palette()
      const writes = await ev(`(() => { window.__writes = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('__slide-editor') && a[1]?.method === 'POST') window.__writes++; return f(...a) }; return 0 })()`)
      const from = await slide(60)
      await saved()
      await sleep(600)
      const block = readBlock(read(), target.id).style
      const shown = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(paragraph)})).color`)
      const posts = await ev(`window.__writes`)
      if (!block.includes('color: color-mix(in srgb, var(--series-2) 60%, transparent)') || !/0\.6\)$/.test(shown)) throw new Error(`the slider wrote "${block}"; the paragraph is ${shown}`)
      if (posts !== 1) throw new Error(`the slider's ${(from - 60) / 5} steps made ${posts} writes, not 1`)
      // A swatch keeps the opacity.
      await status()
      await palette()
      await ev(`document.querySelector('.se-palette [data-value="var(--series-1)"]').click()`)
      await saved()
      const kept = readBlock(read(), target.id).style
      if (!kept.includes('color: color-mix(in srgb, var(--series-1) 60%, transparent)')) throw new Error(`after a swatch the style is "${kept}"`)
      // Selected words: the slider, let go at 50%, colors just them, and the palette closes.
      const spot = await ev(`(() => {
        const t = [...document.querySelector(${JSON.stringify(paragraph)}).childNodes].find((n) => n.nodeType === 3 && /[A-Za-z]{3,}/.test(n.data))
        const m = t.data.match(/[A-Za-z]{3,}/); const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); const b = r.getBoundingClientRect()
        return { word: m[0], x: b.left + b.width / 2, y: b.top + b.height / 2 }
      })()`)
      await doubleClick(spot.x, spot.y)
      await sleep(300)
      if ((await ev(`getSelection().toString()`)) !== spot.word) throw new Error(`a double-click on "${spot.word}" selected "${await ev(`getSelection().toString()`)}"`)
      await palette()
      await drawn(() => slide(50))
      const span = `<span style="color: color-mix(in srgb, currentColor 50%, transparent)">${spot.word}</span>`
      const closed = await ev(`document.querySelector('.se-palette').hidden`)
      if (!read().includes(span) || !closed) throw new Error(`no ${span} in slides.mdx (palette closed: ${closed})`)
      const line = read().split('\n').find((l) => l.includes(span))
      await undoAll()
      return `${menu} → "${font}"; ${appearance} size box; slider ${from}% → 60% in ${posts} write: "${block}"; a swatch keeps it: "${kept}"; words: ${line.slice(0, 110)}`
    })

    await step('while the eyedropper is open a click only takes a color: the slide list does not change the slide; Esc puts it away', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y)
      await ev(`document.querySelector('.se-slide[data-index="0"]').scrollIntoView({ block: 'center' })`)
      await sleep(200)
      const t = await center('.se-slide[data-index="0"] .se-slide-frame')
      await ev(`document.querySelector('[data-act="eyedrop"]').click()`)
      await drawn(() => click(t.x, t.y))
      const state = await ev(`({ slide: [...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.classList.contains('active')) + 1, layer: !!document.querySelector('.se-eyedrop'), editing: document.body.classList.contains('se-on') })`)
      if (state.slide !== target.slide || state.layer || !state.editing) throw new Error(`after a click on a thumbnail: ${JSON.stringify(state)}`)
      const style = readBlock(read(), target.id).style
      if (!/^color: /.test(style)) throw new Error(`the paragraph's style is "${style}"`)
      await undoAll()
      await ev(`document.querySelector('[data-act="eyedrop"]').click()`)
      await key('Escape')
      await sleep(100)
      const after = await ev(`({ layer: !!document.querySelector('.se-eyedrop'), editing: document.body.classList.contains('se-on') })`)
      if (after.layer || !after.editing) throw new Error(`after Esc: ${JSON.stringify(after)}`)
      return `the click on thumbnail 1 took ${style} and left slide ${state.slide}; Esc put the eyedropper away, editing on`
    })

    await step('the forward icon shows the filled square in front, the backward icon behind an opaque one', async () => {
      const p = await center(paragraph)
      await click(p.x, p.y) // the layer buttons are enabled with a block selected
      // What is on top where the two squares overlap (8, 8 of the 16-unit icon), and its fill.
      const onTop = (value) => ev(`(() => { const svg = document.querySelector('[data-act="layer"][data-value="${value}"] svg').getBoundingClientRect(); const el = document.elementFromPoint(svg.left + svg.width / 2, svg.top + svg.height / 2); return { filled: el.classList.contains('se-fill'), fill: getComputedStyle(el).fill } })()`)
      const [forward, backward] = [await onTop('forward'), await onTop('backward')]
      await key('Escape')
      if (!forward.filled) throw new Error(`in the forward icon the square on top is not the filled one (${forward.fill})`)
      // SVG fills a shape black by default, so an unstyled square on top would look like the filled one.
      const rgb = (c) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
      const distance = Math.hypot(...rgb(forward.fill).map((v, i) => v - rgb(backward.fill)[i]))
      if (backward.filled || backward.fill === 'none' || !(distance > 100)) throw new Error(`in the backward icon the square on top is ${backward.filled ? 'the filled one' : `${backward.fill}, against the filled ${forward.fill}`}`)
      return `on top: forward ${forward.fill}, backward ${backward.fill}`
    })

    await step('✕ while editing stops editing, as Esc does, and stays on the deck', async () => {
      const x = await center('[data-deck="exit"]')
      await click(x.x, x.y)
      await sleep(400)
      const state = await ev(`({ editing: document.body.classList.contains('se-on'), path: location.pathname })`)
      if (state.editing || !state.path.endsWith('/slides/')) throw new Error(JSON.stringify(state))
      await key('e')
      await editing()
      return 'editing off, on the deck'
    })

    await step('from the post, S opens the deck with editing off, although it was on', async () => {
      const stored = await ev(`JSON.parse(sessionStorage.getItem('slide-editor:' + location.pathname)).on`)
      await page.goto(`${started.origin}/posts/how-this-blog-works/`)
      await sleep(800)
      await key('s')
      await page.waitFor(`location.pathname.endsWith('/slides/') && !!document.querySelector('.se-toggle')`, { timeout: 20000, what: 'the deck, from S' })
      await sleep(800)
      const on = await ev(`document.body.classList.contains('se-on')`)
      if (!stored || on) throw new Error(`editing was ${stored ? 'on' : 'off'} before and is ${on ? 'on' : 'off'} on the deck`)
      if (page.problems.length) throw new Error(page.problems.join('\n'))
      return 'editing was on before the post; off on the deck'
    })

    await step('an edited deck builds with its styles, and the build has no editor in it', async () => {
      const edited = applyEdit(original, { type: 'style', id: target.id, set: { translate: '12px -8px', color: 'var(--series-1)' } }).source
      const titled = applyEdit(edited, { type: 'style', id: `${target.slide - 1}/t`, set: { 'font-size': '64px' } }).source
      const inside = applyEdit(titled, { type: 'inner', id: target.id, selector: 'strong', set: { color: 'var(--series-2)' } }).source
      writeFileSync(deckFile, inside)
      dev.kill()
      execFileSync(process.execPath, [join(copy, 'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: copy, stdio: 'pipe' })
      writeFileSync(deckFile, original)
      const html = readFileSync(join(copy, 'dist/posts/how-this-blog-works/slides/index.html'), 'utf8')
      const text = readBlock(original, target.id).text.split(/[*[]/)[0].trim()
      // The build writes an element's style without spaces.
      const styled = html.match(new RegExp(`<p style="translate: ?12px -8px; ?color: ?var\\(--series-1\\)" id="([^"]+)">${escape(text)}`))
      if (!styled) throw new Error('the built deck has no styled paragraph with an id')
      if (!new RegExp(`<style data-box="${styled[1]}">#${styled[1]} > strong \\{ color: var\\(--series-2\\) \\}</style>`).test(html)) throw new Error('the built deck has no inner rule for the paragraph')
      if (!/<h2 style="font-size: ?64px">/.test(html)) throw new Error('the built deck has no styled title')
      if (!/data-medium="slide"/.test(html)) throw new Error('the built deck has no figure with medium="slide"')
      const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
      // The editor's attributes are data-edit and data-edit-*; a figure's own data-edited is not one of them.
      const traces = files(join(copy, 'dist')).filter((f) => /\.(html|js|css)$/.test(f) && /data-edit(?![a-z])|__slide-editor|se-toolbar|initEditor|<Box/.test(readFileSync(f, 'utf8')))
      if (traces.length) throw new Error(`editor traces in ${traces.map((f) => f.slice(copy.length)).join(', ')}`)
      return 'the paragraph, its strong and the title keep their styles; no data-edit, Box or editor code in dist/'
    })
  } catch (error) {
    await check(LABEL, 'the editor checks ran', () => { throw error })
  } finally {
    dev?.kill()
    await browser?.close()
    rmSync(copy, { recursive: true, force: true, maxRetries: 5 })
  }
}
