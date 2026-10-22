// End-to-end checks of the live update (bloggie/live/), run by bloggie/e2e/run.js. Under `npm run dev`, a save of a post
// draws its change in the open page without a reload. The checks save files, so they run on a copy of the
// project with its own dev server, as the slide editor's do (bloggie/e2e/editor.js). The copy gets a post of its own
// (a counter figure, citations, a reader's place below the fold) and a second post, so that the checks do not
// depend on any post the blog has, and still run after `npm run reset`. Each check saves a file as an editor
// would, waits for the page to show the save, and reads the page through the DevTools protocol. A second page
// shows the other post, as when an agent works on one post while the author reads another.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyProject, startDev } from './editor.js'

const SECOND_SOURCE = { type: 'paper', title: 'A second source', authors: ['A. Author'], year: 2026, venue: 'e2e', url: 'https://example.com/' }

const LABEL = 'live update'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lines = (n, word) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1}, long enough to fill most of one line of the text column.`).join('\n\n')

const COUNTER = `<script>
  // The live update's check figure: a count that only a restart of the figure sets back to 0.
  import { word } from './counter.js'
  let { params, medium = 'blog' } = $props()
  let count = $state(0)
</script>

<div class="e2e-counter" data-medium={medium}>
  <button type="button" onclick={() => count++}>Add one</button> <output>{count}</output> <span>{params.label}</span> <i>{word}</i>
</div>

<style>
  .e2e-counter { padding: 2rem 0; }
</style>
`
const COUNTER_JS = `export const word = 'first word'\n`

const POST = `---
layout: '@bloggie/layouts/Post.astro'
title: Live update check
date: 2026-01-01
---

import Cite from '@bloggie/components/Cite.astro'
import Counter from '@/figures/e2e-live/Counter.svelte'
import params from './data/counter.json'

<h2 id="top">Top</h2>

${lines(6, 'Top')}

<div id="fig-counter"><Counter client:load params={params} /></div>

${lines(12, 'Middle')}

<h2 id="reader">Where the reader is</h2>

A transformer <Cite key="vaswani2017">[Transformer]</Cite> attends to every token.

${lines(40, 'Below')}
`

const OTHER = `---
layout: '@bloggie/layouts/Post.astro'
title: Live update check, another post
date: 2026-01-02
---

${lines(3, 'Other')}
`

export async function liveChecks({ check, launch, root }) {
  const copy = copyProject(root, 'live-update-e2e-')
  // A second source for the check that citations are numbered again when a new one comes first.
  const referencesPath = join(copy, 'src/references.json')
  writeFileSync(referencesPath, JSON.stringify({ ...JSON.parse(readFileSync(referencesPath, 'utf8')), 'e2e-second': SECOND_SOURCE }, null, 2))
  const post = join(copy, 'src/pages/posts/e2e-live')
  const files = {
    post: join(post, 'index.mdx'),
    data: join(post, 'data/counter.json'),
    figure: join(copy, 'src/figures/e2e-live/Counter.svelte'),
    module: join(copy, 'src/figures/e2e-live/counter.js'),
    other: join(copy, 'src/pages/posts/e2e-live-other/index.mdx'),
    notes: join(post, '_experiments/NOTES.md'),
    deck: join(copy, 'src/pages/posts/how-this-blog-works/slides.mdx'),
  }
  for (const dir of ['src/pages/posts/e2e-live/data', 'src/pages/posts/e2e-live/_experiments', 'src/figures/e2e-live', 'src/pages/posts/e2e-live-other']) mkdirSync(join(copy, dir), { recursive: true })
  writeFileSync(files.post, POST)
  writeFileSync(files.data, JSON.stringify({ label: 'first label' }))
  writeFileSync(files.figure, COUNTER)
  writeFileSync(files.module, COUNTER_JS)
  writeFileSync(files.other, OTHER)
  writeFileSync(files.notes, '# Notes\n')
  const originals = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, readFileSync(file, 'utf8')]))
  const restore = () => { for (const [name, file] of Object.entries(files)) writeFileSync(file, originals[name]) }

  let dev = null
  let browser = null
  try {
    const started = await startDev(copy)
    dev = started.dev
    browser = await launch()
    const page = await browser.newPage({ width: 1280, height: 900 })
    const second = await browser.newPage({ width: 1280, height: 900 })
    const ev = (js) => page.evaluate(js)
    // A page freshly loaded, marked so that a reload shows (the mark is gone), and watched for changes to its <main>.
    const open = async (path = '/posts/e2e-live/', on = page) => {
      await on.goto(`${started.origin}${path}`)
      await on.waitFor(`document.readyState === 'complete'`)
      await sleep(600) // the page says it can draw a change (live:ready) once its scripts ran
      await on.evaluate(`window.__e2eLive = 1; window.__e2eMutations = 0; new MutationObserver((l) => { window.__e2eMutations += l.length }).observe(document.querySelector('main'), { childList: true, subtree: true, attributes: true, characterData: true })`)
    }
    const reloaded = (timeout = 20000) => page.waitFor(`window.__e2eLive !== 1 && document.readyState === 'complete'`, { timeout, what: 'the page to reload' })
    const notReloaded = async (on = page, which = 'the page') => { if ((await on.evaluate('window.__e2eLive')) !== 1) throw new Error(`${which} reloaded`) }
    // Each page's fetches of its own render: the live update fetches one for each save it is told of.
    const renders = (path) => `performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === '${path}').length`
    const count = () => ev(`Number(document.querySelector('.e2e-counter output')?.textContent)`)
    // Each check ends with the copy's files as they were; a check fails on any error the page logged, but
    // the render error's, which it causes.
    const step = async (name, fn, { errors = false } = {}) => {
      await check(LABEL, name, async () => {
        try {
          const observed = await fn()
          if (!errors && page.problems.length) throw new Error(page.problems.join('\n'))
          return observed
        } finally { restore(); await sleep(1500) }
      })
    }

    await step('a save of the post draws it in place: no reload, the reader keeps their place, a running figure keeps its state', async () => {
      await open()
      await page.waitFor(`document.querySelector('.e2e-counter button')`, { what: 'the counter to hydrate' })
      for (let i = 0; i < 3; i++) await ev(`document.querySelector('.e2e-counter button').click()`)
      // Without the browser's own scroll anchoring, as in Safari, which has none: the update keeps the place itself.
      await ev(`document.documentElement.style.overflowAnchor = 'none'; document.getElementById('reader').scrollIntoView({ block: 'start' })`)
      await sleep(300)
      const top = await ev(`document.getElementById('reader').getBoundingClientRect().top`)
      // Above the reader: a longer paragraph, a new heading, and a citation that comes before the transformer's.
      writeFileSync(files.post, originals.post.replace('Top paragraph 2,', `Top paragraph 2 now cites a second source <Cite key="e2e-second">[Second]</Cite>, and is long enough to wrap onto a second line of the text column, so that the page grows above the reader.\n\n<h2 id="added">Added heading</h2>\n\nTop paragraph 2,`))
      await page.waitFor(`document.getElementById('added')`, { what: 'the new heading' })
      await sleep(300)
      await notReloaded()
      const after = await ev(`({ count: Number(document.querySelector('.e2e-counter output').textContent), top: document.getElementById('reader').getBoundingClientRect().top, anchor: !!document.querySelector('#added .heading-anchor'), markers: [...document.querySelectorAll('.citation-marker')].map((b) => b.textContent), references: [...document.querySelectorAll('.reference-list li')].map((li) => li.id) })`)
      if (after.count !== 3) throw new Error(`the counter reads ${after.count}, not 3: the figure started again`)
      if (Math.abs(after.top - top) > 1) throw new Error(`the reader's heading moved from ${top} to ${after.top} px`)
      if (!after.anchor) throw new Error('the new heading has no # anchor')
      if (after.markers.join() !== '[1],[2]' || after.references.join() !== 'ref-e2e-second,ref-vaswani2017') throw new Error(`citations ${after.markers.join()}, references ${after.references.join()}: the second source, now first, should be [1]`)
      return { counter: after.count, readerMoved: +(after.top - top).toFixed(2), citations: after.markers, references: after.references }
    })

    await step('a figure whose props change starts again, with the new props', async () => {
      await open()
      await page.waitFor(`document.querySelector('.e2e-counter button')`, { what: 'the counter to hydrate' })
      await ev(`document.querySelector('.e2e-counter button').click()`)
      writeFileSync(files.data, JSON.stringify({ label: 'second label' }))
      await page.waitFor(`document.querySelector('.e2e-counter')?.textContent.includes('second label')`, { what: 'the new label' })
      await notReloaded()
      if ((await count()) !== 0) throw new Error(`the counter reads ${await count()}: the figure kept its old state`)
      return 'the counter shows the new label and starts again at 0'
    })

    await step('a save of another post leaves this page as it is', async () => {
      await open()
      const fetches = renders('/posts/e2e-live/')
      const before = await ev(fetches)
      writeFileSync(files.other, originals.other.replace('Other paragraph 1,', 'Other paragraph 1, changed,'))
      await page.waitFor(`${fetches} > ${before}`, { what: 'the page to fetch its new render' })
      await sleep(1000)
      await notReloaded()
      const mutations = await ev('window.__e2eMutations')
      if (mutations) throw new Error(`${mutations} changes to the page's <main>`)
      return 'the page fetched its render, found it the same, and changed nothing'
    })

    await step('saves in a burst: the page ends with the last one', async () => {
      await open()
      for (let i = 1; i <= 4; i++) {
        writeFileSync(files.post, originals.post.replace('<h2 id="reader">Where the reader is</h2>', `<h2 id="reader">Where the reader is, save ${i}</h2>`))
        await sleep(150)
      }
      await page.waitFor(`document.getElementById('reader')?.textContent.includes('save 4')`, { what: 'the last save' })
      await notReloaded()
      return 'the heading reads "save 4"'
    })

    // A figure's code runs in the page: only a reload puts in the new code. A post that does not run it stays as it is.
    await step('a save of a figure\'s code reloads the page that runs it, and no other', async () => {
      await open()
      await open('/posts/e2e-live-other/', second)
      writeFileSync(files.figure, originals.figure.replace('Add one', 'Add 1'))
      await reloaded()
      await page.waitFor(`document.querySelector('.e2e-counter button')?.textContent === 'Add 1'`, { what: 'the new code' })
      await sleep(1000)
      await notReloaded(second, 'the other post')
      return 'the page reloaded with the new figure; the other post did not'
    })

    await step('a save of a module that a figure imports reloads the page that runs it, and no other', async () => {
      await open()
      await open('/posts/e2e-live-other/', second)
      writeFileSync(files.module, COUNTER_JS.replace('first word', 'second word'))
      await reloaded()
      await page.waitFor(`document.querySelector('.e2e-counter i')?.textContent === 'second word'`, { what: 'the new module' })
      await sleep(1000)
      await notReloaded(second, 'the other post')
      return 'the page reloaded with the new module; the other post did not'
    })

    // After a page fails to render, Astro reloads every page on the next save of any file, until a page renders.
    await step('after another post fails to render, a save of any file leaves this page as it is', async () => {
      await open()
      writeFileSync(files.other, originals.other.replace('Other paragraph 1,', 'Other <b>paragraph</i> 1,'))
      await sleep(1500)
      const status = (await fetch(`${started.origin}/posts/e2e-live-other/`)).status
      if (status !== 500) throw new Error(`the broken post answers ${status}, not 500`)
      const before = await ev(renders('/posts/e2e-live/'))
      writeFileSync(files.notes, '# Notes\n\nA run.\n')
      await page.waitFor(`window.__e2eLive !== 1 || ${renders('/posts/e2e-live/')} > ${before}`, { what: 'the page to hear of the save' })
      await sleep(1000)
      await notReloaded()
      const mutations = await ev('window.__e2eMutations')
      if (mutations) throw new Error(`${mutations} changes to the page's <main>`)
      return 'the page fetched its render, found it the same, and changed nothing'
    })

    await step('a render error shows Astro\'s error page, and the post comes back when the file is fixed', async () => {
      await open()
      writeFileSync(files.post, originals.post.replace('<h2 id="top">Top</h2>', '<h2 id="top">Top</h3>'))
      await reloaded()
      const title = await ev('document.title')
      if (/Live update check/.test(title)) throw new Error(`the page shows the post ("${title}"), not the error`)
      writeFileSync(files.post, originals.post)
      await page.waitFor(`document.getElementById('top')?.textContent.startsWith('Top')`, { what: 'the post again' })
      return `the error page ("${title}"), then the post`
    }, { errors: true })

    await step('a save of a deck\'s slides.mdx from an editor reloads the deck', async () => {
      await open('/posts/how-this-blog-works/slides/')
      writeFileSync(files.deck, `${originals.deck}\n`)
      await reloaded()
      return 'the deck reloaded'
    })
  } catch (error) {
    await check(LABEL, 'the live update checks ran', () => { throw error })
  } finally {
    dev?.kill()
    await browser?.close()
    rmSync(copy, { recursive: true, force: true, maxRetries: 5 })
  }
}
