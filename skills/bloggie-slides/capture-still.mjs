// Capture the still image of an animation (rule 18): open a deck's slide or a post, bring the figure to the state that
// shows its idea, and save that one frame as WebP. Needs no install: it drives headless Chromium through
// bloggie/e2e/browser.js. With `npm run dev` running:
//
//   node .agents/skills/bloggie-slides/capture-still.mjs <URL> <out.webp> [options]
//
//   <URL>                  a deck's slide (…/slides/#4) or a post (…/posts/<slug>/)
//   --selector <css>       what to capture (default on a deck: the shown slide's figure area, .demo; required on a post)
//   --press <aria-label>   click the button with this aria-label inside it, e.g. --press play (repeatable, in order)
//   --set <label>=<value>  set the slider or select with this aria-label, e.g. --set "loop iteration=5" (repeatable)
//   --wait <ms>            wait after the presses and sets, for the animation to reach its state (default 500)
//   --scale <n>            device pixels per CSS pixel (default 2: a slide's figure area becomes about 3000 px wide)
//   --quality <n>          WebP quality, 0 to 100 (default 80)
//
// The capture leaves out what print leaves out: the figure's controls (.controls) and, on a slide, the note over the
// figure, which the PDF draws itself. An out file that ends in .png or .jpg is written in that format instead.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from '../../e2e/browser.js'

const { values: opts, positionals: [url, out] } = parseArgs({ allowPositionals: true, options: {
  selector: { type: 'string' },
  press: { type: 'string', multiple: true, default: [] },
  set: { type: 'string', multiple: true, default: [] },
  wait: { type: 'string', default: '500' },
  scale: { type: 'string', default: '2' },
  quality: { type: 'string', default: '80' },
} })
if (!url || !out) throw new Error('usage: node capture-still.mjs <URL> <out.webp> [--selector <css>] [--press <aria-label>] [--set <label>=<value>] [--wait <ms>]')
const format = { '.webp': 'webp', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg' }[extname(out).toLowerCase()]
if (!format) throw new Error(`capture-still: ${out} must end in .webp, .png or .jpg`)

const browser = await launch()
// A deck's stage is 1600×900 at scale 1 in a window this size (the nav takes 36 px); a post gets a desktop width.
const page = await browser.newPage({ width: 1600, height: 936 })
try {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 936, deviceScaleFactor: Number(opts.scale), mobile: false })
  await page.goto(url)
  const deck = await page.evaluate(`!!document.querySelector('.deck > .slide')`)
  const selector = opts.selector ?? (deck ? '.deck > .slide.active .demo' : null)
  if (!selector) throw new Error('capture-still: on a post, give --selector, such as --selector "#fig-walk"')
  const found = JSON.stringify(selector)
  await page.waitFor(`document.querySelector(${found})`, { what: `${selector} on the page` })
  await page.evaluate(`document.querySelector(${found}).scrollIntoView({ block: 'center' })`)
  await page.waitFor(`[...document.querySelector(${found}).querySelectorAll('astro-island')].every((el) => !el.hasAttribute('ssr'))`, { timeout: 30000, what: 'the figure to start' })
  await page.evaluate(`new Promise((r) => setTimeout(r, 400))`)
  for (const label of opts.press) {
    await page.evaluate(`(() => { const el = document.querySelector(${found}).querySelector('button[aria-label=${JSON.stringify(label)}]'); if (!el) throw new Error('no button with aria-label ' + ${JSON.stringify(label)}); el.click() })()`)
  }
  for (const pair of opts.set) {
    const at = pair.lastIndexOf('=')
    const [label, value] = [pair.slice(0, at), pair.slice(at + 1)]
    await page.evaluate(`(() => { const el = document.querySelector(${found}).querySelector(':is(input, select)[aria-label=${JSON.stringify(label)}]'); if (!el) throw new Error('no input or select with aria-label ' + ${JSON.stringify(label)}); el.value = ${JSON.stringify(value)}; for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true })) })()`)
  }
  await page.evaluate(`new Promise((r) => setTimeout(r, ${Number(opts.wait)}))`)
  const clip = await page.evaluate(`(() => {
    const style = document.createElement('style')
    style.textContent = '.controls { display: none !important } .demo-note { visibility: hidden !important }'
    document.head.append(style)
    const r = document.querySelector(${found}).getBoundingClientRect()
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }
  })()`)
  await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
  const { data } = await page.cdp('Page.captureScreenshot', { format, ...(format === 'png' ? {} : { quality: Number(opts.quality) }), clip, captureBeyondViewport: true })
  const image = Buffer.from(data, 'base64')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, image)
  console.log(`capture-still: ${out}, ${Math.round(clip.width * opts.scale)}×${Math.round(clip.height * opts.scale)}, ${Math.round(image.length / 1024)} KB`)
} finally {
  await browser.close()
}
