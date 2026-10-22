// Check every slide of a deck: overflow, the smallest text outside demos, KaTeX errors, code without
// syntax highlighting, and a screenshot per slide. Run from a scratch directory with playwright installed:
//   node check-slides.mjs http://localhost:4321/posts/<slug>/slides/ <screenshot-dir>

import { chromium } from 'playwright'
const out = process.argv[3] || 'slide-shots'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 936 } })
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
await p.goto(process.argv[2], { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
console.log('katex errors', await p.locator('.katex-error').count())
const n = await p.locator('.deck > .slide').count()
for (let i = 1; i <= n; i++) {
  await p.evaluate((i) => { location.hash = `#${i}.99` }, i)
  await p.waitForTimeout(450)
  const r = await p.evaluate(() => {
    const s = document.querySelector('.slide.active')
    let min = Infinity, minText = ''
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement
      if (!node.textContent.replace(/[\u200b\s]/g, "") || el.closest('.demo, aside, script, .katex-mathml, .msupsub')) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < min) { min = fs; minText = node.textContent.trim().slice(0, 30) }
    }
    const heading = s.querySelector('h1, h2')
    const lines = heading ? Math.round(heading.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight)) : 0
    const demo = s.querySelector('.demo')
    // Rule 16: a code block needs at least two token colors; inline code outside a block is not allowed.
    const code = [...s.querySelectorAll('pre')].filter((pre) => !pre.closest('.demo')).map((pre) => new Set([...pre.querySelectorAll('span[style*="color"]')].map((t) => t.style.color)).size)
    const inline = [...s.querySelectorAll('code')].filter((c) => !c.closest('pre, .demo, aside, table')).length // a post's table (PostTable) keeps its code
    return { title: s.dataset.title, lines, slide: `${s.scrollHeight}/${s.clientHeight}`, demo: demo ? `${demo.scrollHeight}/${demo.clientHeight}` : '', min, minText, code, inline }
  })
  const flag = (r.demo && +r.demo.split('/')[0] > +r.demo.split('/')[1] + 2) || +r.slide.split('/')[0] > 900 || r.min < 36 || r.lines > 2 || r.code.some((colors) => colors < 2) || r.inline ? '  <-- CHECK' : ''
  console.log(i, r.title, '| slide', r.slide, '| demo', r.demo, '| title lines', r.lines, '| min font', r.min, JSON.stringify(r.minText), '| code colors', r.code.join(',') || '-', '| inline code', r.inline, flag)
  await p.screenshot({ path: `${out}/s${String(i).padStart(2, '0')}.png` })
}
console.log('errors', errs.filter(e => !e.includes('mp4')))
await b.close()
