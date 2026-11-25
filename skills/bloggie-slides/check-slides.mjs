// Check every slide of a deck: overflow, the smallest text outside demos, title lines, KaTeX errors, code without
// syntax highlighting, inline code, and a screenshot per slide. Then the stills: for each animation (a figure, a video,
// a YouTube player, an embedded page), the still image that the "Slides as PDF" download shows in its place, with its
// size and encoding, and a screenshot of the slide as the PDF holds it (sNN-pdf.png). Needs no install: it drives
// headless Chromium through bloggie/e2e/browser.js, as `npm run e2e` does. With `npm run dev` running:
//   node .agents/skills/bloggie-slides/check-slides.mjs http://localhost:4321/posts/<slug>/slides/ <screenshot-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../../e2e/browser.js'
import { preparePrint } from '../../lib/print.js'

const [url, out = 'slide-shots'] = process.argv.slice(2)
if (!url) throw new Error('usage: node check-slides.mjs <deck URL> [screenshot-dir]')
mkdirSync(out, { recursive: true })

const browser = await launch()
const page = await browser.newPage({ width: 1600, height: 936 })
await page.goto(url)
await page.waitFor(`document.querySelectorAll('.deck > .slide').length`, { what: 'the deck' })
const n = await page.evaluate(`document.querySelectorAll('.deck > .slide').length`)
console.log('katex errors', await page.evaluate(`document.querySelectorAll('.katex-error').length`))

let flagged = 0
for (let i = 1; i <= n; i++) {
  // #i.99: slide i with every build shown.
  await page.evaluate(`location.hash = '#${i}.99'; new Promise((r) => setTimeout(r, 600))`)
  const r = await page.evaluate(`(() => {
    const s = document.querySelector('.deck > .slide.active')
    let min = Infinity, minText = ''
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement
      if (!node.textContent.replace(/[\\u200b\\s]/g, '') || el.closest('.demo, aside, script, .katex-mathml, .msupsub')) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < min) { min = fs; minText = node.textContent.trim().slice(0, 30) }
    }
    const heading = s.querySelector('h1, h2')
    const lines = heading ? Math.round(heading.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight)) : 0
    const demo = s.querySelector('.demo')
    // Rule 17: a code block needs at least two token colors; inline code outside a block is not allowed.
    const code = [...s.querySelectorAll('pre')].filter((pre) => !pre.closest('.demo')).map((pre) => ({ colors: new Set([...pre.querySelectorAll('span[style*="color"]')].map((t) => t.style.color)).size, wide: pre.scrollWidth > pre.clientWidth + 2 }))
    const inline = [...s.querySelectorAll('code')].filter((c) => !c.closest('pre, .demo, aside, table')).length // a post's table (PostTable) keeps its code
    // Content wider than the stage: an element whose right edge passes the slide's.
    const right = s.getBoundingClientRect().right
    const wide = [...s.querySelectorAll('table, pre, img, svg, .slide-body > *')].some((e) => !e.closest('.demo') && e.getBoundingClientRect().right > right + 2)
    // The body drawn over the title: its first element starts above the title's bottom edge.
    const body = s.querySelector('.slide-body')
    const overlap = !!(heading && body && body.firstElementChild && body.firstElementChild.getBoundingClientRect().top < heading.getBoundingClientRect().bottom - 2)
    return { title: s.dataset.title, lines, wide, overlap, slide: [s.scrollHeight, s.clientHeight], demo: demo ? [demo.scrollHeight, demo.clientHeight] : null, min, minText, code, inline }
  })()`)
  const problems = [
    r.slide[0] > 900 && 'overflows the stage',
    r.wide && 'wider than the stage',
    r.overlap && 'the body overlaps the title',
    r.demo && r.demo[0] > r.demo[1] + 2 && 'demo overflows',
    r.min < 36 && `text at ${r.min}px ("${r.minText}")`,
    r.lines > 2 && `title on ${r.lines} lines`,
    r.code.some((c) => c.colors < 2) && 'code without highlighting',
    r.code.some((c) => c.wide) && 'code scrolls sideways',
    r.inline && `${r.inline} inline code`,
  ].filter(Boolean)
  if (problems.length) flagged++
  console.log(`${i} ${r.title ?? ''}${problems.length ? `  <-- CHECK: ${problems.join('; ')}` : ''}`)
  writeFileSync(join(out, `s${String(i).padStart(2, '0')}.png`), await page.screenshot('.deck > .slide.active'))
}
console.log(`${n} slides, ${flagged} to check; screenshots in ${out}`)
console.log('page errors', page.problems.filter((e) => !e.includes('mp4')))

// The stills (rule 18). A still is `<Still src alt />` right after its animation (bloggie/components/Still.astro); a
// video's poster is its still when it has no other. The limits: 300 KB, and 3200 px wide (twice the stage).
const MAX_KB = 300, MAX_WIDTH = 3200
const media = await page.evaluate(`Promise.all([...document.querySelectorAll('.deck > .slide')].map(async (slide, i) => ({
  slide: i + 1,
  title: slide.dataset.title ?? '',
  items: await Promise.all([...slide.querySelectorAll('astro-island, video, iframe')].map(async (el) => {
    const what = el.matches('astro-island') ? 'figure ' + JSON.parse(el.getAttribute('opts')).name : el.matches('video') ? 'video' : el.matches('.youtube') ? 'YouTube video' : 'embedded page'
    const next = (el.closest('.embed-crop') ?? el).nextElementSibling
    const src = next?.matches('img.still') ? next.getAttribute('src') : el.getAttribute('poster')
    if (!src) return { what }
    const blob = await fetch(src).then((res) => res.blob()).catch(() => null)
    const image = new Image()
    image.src = src
    const loads = await image.decode().then(() => true, () => false)
    return { what, poster: !next?.matches('img.still'), name: new URL(src, location.href).pathname.split('/').pop(), alt: next?.alt, loads, kb: blob ? Math.round(blob.size / 1024) : null, type: blob?.type ?? '', width: image.naturalWidth, height: image.naturalHeight }
  })),
})))`)
const animated = media.filter((m) => m.items.length)
if (animated.length) {
  console.log('\nstills: what "Slides as PDF" shows in place of each animation')
  // The deck as the PDF holds it: print media, with the changes lib/print.js makes.
  await page.cdp('Emulation.setEmulatedMedia', { media: 'print' })
  await page.evaluate(`(${preparePrint})()`)
  await page.evaluate(`new Promise((r) => setTimeout(r, 500))`)
  let toCheck = 0
  for (const { slide, title, items } of animated) {
    for (const item of items) {
      const vector = /svg/.test(item.type ?? '')
      const problems = !item.name
        ? [item.what.startsWith('figure') ? null : item.what === 'video' ? 'no still and no poster: the PDF shows an empty frame' : 'no still: the PDF shows only its title and link']
        : [
            !item.loads && 'does not load',
            item.kb > MAX_KB && `${item.kb} KB is over ${MAX_KB} KB`,
            !vector && item.width > MAX_WIDTH && `${item.width} px wide is over ${MAX_WIDTH} px`,
            /gif/.test(item.type) && 'a GIF: encode as WebP or AVIF',
            /png/.test(item.type) && item.kb > 150 && 'a large PNG: encode as WebP or AVIF, or draw a diagram as SVG',
          ]
      const flags = problems.filter(Boolean)
      if (flags.length) toCheck++
      const state = !item.name ? 'no still; the PDF shows it as it first appears' : `${item.poster ? 'its poster' : 'still'} ${item.name}, ${item.width}×${item.height}, ${item.kb} KB${item.alt ? `, "${item.alt}"` : ''}`
      console.log(`${slide} ${title}  ${item.what}: ${state}${flags.length ? `  <-- CHECK: ${flags.join('; ')}` : ''}`)
    }
    await page.evaluate(`document.querySelectorAll('.deck > .slide')[${slide - 1}].dataset.pdfShot = ''`)
    writeFileSync(join(out, `s${String(slide).padStart(2, '0')}-pdf.png`), await page.screenshot('.deck > .slide[data-pdf-shot]'))
    await page.evaluate(`delete document.querySelectorAll('.deck > .slide')[${slide - 1}].dataset.pdfShot`)
  }
  console.log(`${animated.length} slides with an animation, ${toCheck} stills to check; look at each sNN-pdf.png: does the slide still give its idea?`)
}
await browser.close()
