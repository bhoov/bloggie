// End-to-end checks of jump to source (bloggie/jump/), run by bloggie/e2e/run.js. Under `npm run dev`, a Cmd+Shift+click
// on a post or a deck opens the file that wrote what was clicked, at the word clicked. The checks run on a copy of the
// project with its own dev server, as the live update's do (bloggie/e2e/live.js), with a post, a deck and a figure of
// their own, so that they do not depend on the blog's posts. Each check clicks with real mouse input, reads the answer
// the page gets from the dev server (a fetch, recorded in the page), and compares the line and column it names with
// the file on disk. The dev server runs with JUMP_TO_SOURCE=remote and then local: it opens no file in a VS Code window
// itself, and the page opens a vscode:// link, which the browser records. If the blog has the example post, every
// word of it is clicked as well.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { copyProject, startDev } from './editor.js'

const LABEL = 'jump to source'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const POST = `---
layout: '@bloggie/layouts/Post.astro'
title: Jump to source check
date: 2026-01-01
---

import Cite from '@bloggie/components/Cite.astro'
import RoleKey from '@bloggie/components/RoleKey.astro'
import Dots from '@/figures/e2e-jump/Dots.svelte'

<h2 id="top">Opening heading</h2>

First sentence of the opening paragraph sits here.
Second sentence mentions Wolverhampton on its own line.
Third sentence has *emphasis with Ipswich*, \`inline Leicester code\` and a [link to Norwich](https://example.com/) in it.

- **Bold Arundel.**
  An indented line names Grimsby.

Inline math $x_{1}$ sits in a sentence, and a display follows.

$$
y = W x
$$

\`\`\`sh
echo Penzance
echo Truro
\`\`\`

A citation <Cite key="vaswani2017">[Transformer]</Cite> sits in this sentence.

<RoleKey />

<div id="fig-dots">

Caption paragraph that names Kalamazoo before the figure.

<Dots client:load />

</div>

Closing paragraph names Timbuktu.
`

const DECK = `---
layout: '@bloggie/layouts/Slides.astro'
title: Jump to source check (slides)
---

import RoleKey from '@bloggie/components/RoleKey.astro'
import Dots from '@/figures/e2e-jump/Dots.svelte'

# Jump Check Deck

## First Slide Says Hello

Slide text names Aberdeen.

<Notes>Notes on the first slide name Dundee.</Notes>

## Second Slide Shows Roles

<RoleKey />

## Third Slide Shows Dots

<Dots client:load />
`

const DOTS = `<script>
  // The jump-to-source check figure: elements whose tags Svelte marks with their place in this file.
  let { medium = 'blog' } = $props()
</script>

<svg class="e2e-dots" data-medium={medium} viewBox="0 0 100 20" width="400" height="80">
  <circle cx="10" cy="10" r="8" />
  <rect x="30" y="2" width="16" height="16" />
</svg>
`

// The page records each answer of the dev server, before any of its scripts runs.
const RECORD = `window.__jumps = []
const realFetch = window.fetch
window.fetch = async (...args) => {
  const res = await realFetch(...args)
  if (String(args[0]).includes('__jump-to-source')) res.clone().json().then((answer) => window.__jumps.push(answer))
  return res
}`

// The point just inside the first letter of `word` in the first text node under `root` that has it as a whole word.
const wordPoint = (word, root = `document.querySelector('main')`) => `(() => {
  const walker = document.createTreeWalker(${root}, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = new RegExp('\\\\b${word}\\\\b').exec(n.data)
    if (!m) continue
    const r = document.createRange()
    r.setStart(n, m.index); r.setEnd(n, m.index + 1)
    const box = r.getClientRects()[0]
    if (box) return { x: box.left + 1, y: box.top + box.height / 2 }
  }
  return null
})()`
const boxPoint = (selector, dx = 2) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + ${dx}, y: r.top + r.height / 2 } })()`

export async function jumpChecks({ check, launch, root }) {
  const copy = copyProject(root, 'jump-e2e-')
  const post = join(copy, 'src/pages/posts/e2e-jump')
  const files = { post: join(post, 'index.mdx'), deck: join(post, 'slides.mdx'), figure: join(copy, 'src/figures/e2e-jump/Dots.svelte') }
  for (const dir of [post, join(copy, 'src/figures/e2e-jump')]) mkdirSync(dir, { recursive: true })
  writeFileSync(files.post, POST)
  writeFileSync(files.deck, DECK)
  writeFileSync(files.figure, DOTS)

  let dev = null
  let browser = null
  try {
    browser = await launch()
    const page = await browser.newPage({ width: 1280, height: 4000 })
    await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: RECORD })
    let origin = ''
    const open = async (path) => {
      await page.goto(`${origin}${path}`)
      await page.waitFor(`document.querySelector('[data-src-file]')`, { what: 'the source positions' })
    }
    // A Cmd+Shift+click (or with Option too) at a point, and the dev server's answer to it.
    const jump = async (point, modifiers = 4 | 8) => {
      if (!point) throw new Error('nothing to click')
      const before = await page.evaluate('window.__jumps.length')
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await page.cdp('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, modifiers, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) })
      }
      return page.waitFor(`window.__jumps.length > ${before} && window.__jumps.at(-1)`, { what: 'the dev server to answer' })
    }
    const lineOf = (answer) => readFileSync(answer.file, 'utf8').split('\n')[answer.line - 1] ?? ''
    // The answer names `file` (a path ending), and its line holds `text` at its column.
    const opens = (answer, file, text) => {
      const at = lineOf(answer).slice(answer.column - 1)
      if (!answer.file.endsWith(file) || !at.startsWith(text)) throw new Error(`${answer.file}:${answer.line}:${answer.column} ("${at.slice(0, 50)}"), not ${file} at "${text}"`)
      return `${file.split('/').at(-1)}:${answer.line}:${answer.column}`
    }
    const POST_FILE = 'src/pages/posts/e2e-jump/index.mdx'
    const DECK_FILE = 'src/pages/posts/e2e-jump/slides.mdx'

    // --- the dev server says the author's browser is on another machine --------------------------------------------
    const remote = await startDev(copy, { JUMP_TO_SOURCE: 'remote' })
    dev = remote.dev
    origin = remote.origin

    await check(LABEL, 'a word on the second line of a paragraph opens that line, at the word', async () => {
      await open('/posts/e2e-jump/')
      const answer = await jump(await page.evaluate(wordPoint('Wolverhampton')))
      if (!answer.remote || answer.opened) throw new Error(`the dev server answered remote ${answer.remote}, opened ${answer.opened}`)
      return opens(answer, POST_FILE, 'Wolverhampton')
    })

    // The click of the check above was the page's first: it asks for the host.
    await check(LABEL, 'the first time, the page asks for the SSH host, opens a vscode-remote link through it, and keeps it', async () => {
      const point = await page.evaluate(wordPoint('Wolverhampton'))
      const answer = await page.evaluate('window.__jumps.at(-1)')
      await page.waitFor(`document.querySelector('form[role=dialog] input')`, { what: 'the SSH host dialog' })
      await page.evaluate(`document.querySelector('form[role=dialog] input').value = 'e2e-host'; document.querySelector('form[role=dialog] button[type=submit]').click()`)
      const link = `vscode://vscode-remote/ssh-remote+e2e-host${answer.file}:${answer.line}:${answer.column}`
      await sleep(500)
      if (!page.navigations.includes(link)) throw new Error(`no ${link}; navigations: ${page.navigations.join(', ')}`)
      page.navigations.length = 0
      await jump(point)
      await sleep(500)
      if (await page.evaluate(`!!document.querySelector('form[role=dialog]')`)) throw new Error('the page asked again')
      if (!page.navigations.includes(link)) throw new Error(`the second click opened ${page.navigations.join(', ') || 'nothing'}`)
      return link
    })

    await check(LABEL, 'a word in emphasis, in inline code and in a link opens at that word; the link is not followed', async () => {
      const href = await page.evaluate('location.href')
      const seen = []
      for (const word of ['Ipswich', 'Leicester', 'Norwich']) seen.push(opens(await jump(await page.evaluate(wordPoint(word))), POST_FILE, word))
      await sleep(300)
      if ((await page.evaluate('location.href')) !== href) throw new Error('the click followed the link')
      return seen
    })

    await check(LABEL, 'a word on an indented line of a list item opens at that word', async () => {
      return opens(await jump(await page.evaluate(wordPoint('Grimsby'))), POST_FILE, 'Grimsby')
    })

    await check(LABEL, 'a formula opens at its $, inline and displayed', async () => {
      const inline = opens(await jump(await page.evaluate(boxPoint('main p .katex', 4))), POST_FILE, '$x_{1}$')
      const display = opens(await jump(await page.evaluate(`(() => { const r = document.querySelector('main .katex-display .katex').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 } })()`)), POST_FILE, '$$')
      return [inline, display]
    })

    await check(LABEL, 'a line of a code block opens that line', async () => {
      const answer = await jump(await page.evaluate(wordPoint('Truro')))
      if (lineOf(answer).trim() !== 'echo Truro') throw new Error(`line ${answer.line}: "${lineOf(answer)}"`)
      return `line ${answer.line}`
    })

    await check(LABEL, 'a citation\'s number and a component\'s output open the component\'s tag', async () => {
      const answer = await jump(await page.evaluate(boxPoint('main .citation-marker')))
      if (!lineOf(answer).includes('<Cite key="vaswani2017">')) throw new Error(`the citation opens ${answer.line}:${answer.column}: "${lineOf(answer)}"`)
      const cite = `index.mdx:${answer.line}:${answer.column}`
      const roles = opens(await jump(await page.evaluate(boxPoint('main .role-list li'))), POST_FILE, '<RoleKey')
      return [cite, roles]
    })

    await check(LABEL, 'a part of a figure opens its tag in the figure\'s .svelte file', async () => {
      await page.waitFor(`document.querySelector('.e2e-dots circle')?.__svelte_meta`, { what: 'the figure to hydrate' })
      const circle = opens(await jump(await page.evaluate(`(() => { const r = document.querySelector('.e2e-dots circle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)), 'src/figures/e2e-jump/Dots.svelte', '<circle')
      const rect = opens(await jump(await page.evaluate(`(() => { const r = document.querySelector('.e2e-dots rect').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)), 'src/figures/e2e-jump/Dots.svelte', '<rect')
      return [circle, rect]
    })

    // The live update keeps the block with the figure, with the positions of the save it was drawn from; the dev server
    // moves them to the file as it is now.
    await check(LABEL, 'after a save above it, a block the live update kept opens the line its words are on now', async () => {
      await page.evaluate(`document.querySelector('#fig-dots astro-island').__e2eKept = true`)
      writeFileSync(files.post, POST.replace('<h2 id="top">Opening heading</h2>\n', '<h2 id="top">Opening heading</h2>\n\nA new paragraph.\nIt has three lines.\nThe third names Reykjavik.\n'))
      try {
        await page.waitFor(`document.querySelector('main').textContent.includes('Reykjavik')`, { what: 'the live update' })
        await sleep(500)
        if (!(await page.evaluate(`document.querySelector('#fig-dots astro-island').__e2eKept`))) throw new Error('the live update drew the block with the figure again')
        const kept = opens(await jump(await page.evaluate(wordPoint('Kalamazoo'))), POST_FILE, 'Kalamazoo')
        const fresh = opens(await jump(await page.evaluate(wordPoint('Timbuktu'))), POST_FILE, 'Timbuktu')
        return { kept, fresh }
      } finally {
        writeFileSync(files.post, POST)
        await sleep(1500)
      }
    })

    await check(LABEL, 'on a deck: a slide\'s title, its text, and a component after the notes of the slide before; in the slide editor, Enter on a part of a figure', async () => {
      const show = async (text) => {
        const n = await page.evaluate(`[...document.querySelectorAll('.deck > section.slide')].findIndex((s) => s.textContent.includes(${JSON.stringify(text)})) + 1`)
        await page.evaluate(`location.hash = '#${n}'`)
        await page.waitFor(`document.querySelector('.deck > section.slide.active')?.textContent.includes(${JSON.stringify(text)})`, { what: `the slide with "${text}"` })
        await sleep(300)
      }
      await page.goto(`${origin}/posts/e2e-jump/slides/`)
      await page.waitFor(`document.querySelector('.deck section.slide')`, { what: 'the deck' })
      await show('Aberdeen')
      const active = `document.querySelector('.deck > section.slide.active')`
      const title = opens(await jump(await page.evaluate(wordPoint('Says', active))), DECK_FILE, 'Says')
      const text = opens(await jump(await page.evaluate(wordPoint('Aberdeen', active))), DECK_FILE, 'Aberdeen')
      await show('Second Slide')
      const roles = opens(await jump(await page.evaluate(boxPoint('.deck > section.slide.active .role-list li'))), DECK_FILE, '<RoleKey')
      // In the slide editor, Enter on an element inside a figure (selected with a double-click) opens it, as a
      // Cmd+Shift+click does.
      await show('Third Slide')
      await page.waitFor(`${active}.querySelector('.e2e-dots circle')?.__svelte_meta`, { what: 'the figure on the deck to hydrate' })
      const press = async (key, code, vk, text) => {
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text })
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
      }
      await press('e', 'KeyE', 69, 'e')
      await page.waitFor(`document.body.classList.contains('se-on') && document.querySelector('.se-toolbar')`, { what: 'edit mode' })
      const c = await page.evaluate(boxPoint('.deck > section.slide.active .e2e-dots circle', 8))
      for (const clickCount of [1, 2]) {
        await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount })
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount })
      }
      await page.waitFor(`document.querySelector('.se-what')?.textContent.includes('› circle')`, { what: 'the circle selected inside the figure' })
      const before = await page.evaluate('window.__jumps.length')
      await press('Enter', 'Enter', 13, '\r')
      const answer = await page.waitFor(`window.__jumps.length > ${before} && window.__jumps.at(-1)`, { what: 'the dev server to answer the editor' })
      const editor = opens(answer, 'src/figures/e2e-jump/Dots.svelte', '<circle')
      await press('Escape', 'Escape', 27)
      await press('e', 'KeyE', 69, 'e')
      return { title, text, roles, editor }
    })

    if (existsSync(join(copy, 'src/pages/posts/how-this-blog-works/index.mdx'))) {
      await check(LABEL, 'the example post: each word clicked opens a line that holds it (the layout\'s own words aside)', async () => {
        await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 16000, deviceScaleFactor: 1, mobile: false })
        await open('/posts/how-this-blog-works/')
        // Words in view, each with whether the layout wrote it (the header, the role key, what follows the post's text).
        const words = await page.evaluate(`(() => {
          const out = []
          const main = document.querySelector('main')
          const marked = [...main.querySelectorAll('[data-src]')]
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest('.katex, astro-island, script, style, details:not([open])') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const m of n.data.matchAll(/[A-Za-z]{6,}/g)) {
              const r = document.createRange()
              r.setStart(n, m.index); r.setEnd(n, m.index + 1)
              const box = r.getClientRects()[0]
              if (!box) continue
              const x = box.left + 1, y = box.top + box.height / 2
              if (!n.parentElement.contains(document.elementFromPoint(x, y))) continue
              const el = n.parentElement
              const layout = !el.closest('[data-src]') && (!!el.closest('header, .role-key') || !marked.some((d) => el.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING))
              out.push({ word: m[0], x, y, layout })
            }
          }
          return out
        })()`)
        const step = Math.max(1, Math.floor(words.length / 60))
        let exact = 0, line = 0, component = 0, layout = 0
        const wrong = []
        for (let i = 0; i < words.length; i += step) {
          const w = words[i]
          const answer = await jump(w)
          const text = lineOf(answer)
          if (w.layout) layout++
          else if (text.slice(answer.column - 1).startsWith(w.word)) exact++
          else if (text.includes(w.word)) line++
          else if (/<[A-Z]\w*/.test(text)) component++
          else wrong.push(`${w.word} -> ${answer.line}:${answer.column} "${text.slice(0, 60)}"`)
        }
        if (wrong.length) throw new Error(`${wrong.length} words open a line without them: ${wrong.slice(0, 5).join(' | ')}`)
        return { words: exact + line + component + layout, exactColumn: exact, lineOnly: line, componentTag: component, layout }
      })
    }

    dev.kill()
    dev = null

    // --- the dev server says the author's browser is on the same computer -----------------------------------------
    await check(LABEL, 'on the author\'s own computer, the page opens a vscode://file link at the line and column', async () => {
      const started = await startDev(copy, { JUMP_TO_SOURCE: 'local' })
      dev = started.dev
      origin = started.origin
      await open('/posts/e2e-jump/')
      const answer = await jump(await page.evaluate(wordPoint('Wolverhampton')))
      const link = `vscode://file${answer.file}:${answer.line}:${answer.column}`
      await sleep(500)
      if (answer.remote || !page.navigations.includes(link)) throw new Error(`remote ${answer.remote}; navigations: ${page.navigations.join(', ') || 'none'}`)
      opens(answer, POST_FILE, 'Wolverhampton')
      return link.replace(copy, '<copy>')
    })
  } finally {
    dev?.kill()
    await browser?.close()
  }

  // `npm run build` writes no source positions.
  await check(LABEL, 'a built page has no source positions', async () => {
    const pages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []))
    const marked = pages(join(root, 'dist')).filter((file) => / data-src(-[a-z]+)?="/.test(readFileSync(file, 'utf8')))
    if (marked.length) throw new Error(`source positions in ${marked.slice(0, 3).join(', ')}`)
    return 'none in dist/'
  })
}
