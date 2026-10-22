// End-to-end checks of a post's table of contents (bloggie/lib/toc.js, the <nav data-toc> of Post.astro), run by
// bloggie/e2e/run.js.
//   tocList: on a post that run.js has open, the list holds every section heading of the post, in order, and an entry
//     goes to its heading. A section is any h2 or h3 of the text, so a heading the list misses fails it.
//   tocUse: on one post, as a reader uses it, in two windows of its own. Narrow: the bar stays out of the way at the
//     top and while the reader scrolls down, comes in when they scroll up, names the section they are in, opens its
//     list on T, and goes to a section without covering its heading. Wide: the list is in the margin from the start,
//     marks the section on screen, folds away and back on T, and keeps one position beside the widest figure, or fades on overlap in a narrower window.
import { expect } from './helpers.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The post's sections as a reader finds them: every h2 and h3 of its text and of its references, none of a figure's.
const SECTIONS = `[...document.querySelectorAll('main :is(h2, h3)')].filter((h) => !h.closest('astro-island, [data-toc]'))`
const NAV = `document.querySelector('[data-toc]')`
const shown = (page) => page.evaluate(`(() => { const n = ${NAV}; const s = getComputedStyle(n); return !n.hidden && s.visibility === 'visible' && s.opacity === '1' && n.getBoundingClientRect().bottom > 0 })()`)
const press = async (page, key) => {
  for (const type of ['keyDown', 'keyUp']) await page.cdp('Input.dispatchKeyEvent', { type, key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), text: type === 'keyDown' ? key : undefined })
}

export async function tocList(page) {
  const found = await page.evaluate(`(() => {
    const nav = ${NAV}
    const sections = ${SECTIONS}
    return {
      nav: !!nav, hidden: nav?.hidden,
      sections: sections.map((h) => ({ href: '#' + h.id, level: h.localName })),
      links: nav ? [...nav.querySelectorAll('.toc-list a')].map((a) => a.getAttribute('href')) : [],
    }
  })()`)
  if (!found.nav) return 'no table of contents (toc: false)'
  const chapters = found.sections.filter((s) => s.level === 'h2').length
  if (chapters < 3) { expect(found.hidden, `${chapters} sections, and the table of contents shows`); return `${chapters} sections: none` }
  expect(!found.hidden, 'the table of contents is hidden')
  const want = found.sections.map((s) => s.href)
  expect(want.every((href) => href !== '#'), `a section heading has no id: ${JSON.stringify(found.sections)}`)
  expect(JSON.stringify(found.links) === JSON.stringify(want), `the table of contents lists ${found.links.join(' ')}, the post has ${want.join(' ')}`)
  const last = found.links.filter((href) => href !== '#references-title').at(-1)
  await page.evaluate(`${NAV}.querySelector('.toc-list a[href="${last}"]').click()`)
  const hash = await page.evaluate('location.hash')
  expect(hash === last, `the entry ${last} went to ${hash}`)
  return `${found.links.length} entries`
}

export async function tocUse({ check, browser, url, label }) {
  // The longest section, so that a place inside it is still inside it after a scroll of a screen.
  const longest = `(() => { const s = ${SECTIONS}.filter((h) => h.localName === 'h2'); const all = ${SECTIONS}; let best = null, size = 0
    for (const h of s) { const next = all[all.indexOf(h) + 1]; const d = (next ? next.getBoundingClientRect().top : document.body.scrollHeight) - h.getBoundingClientRect().top; if (d > size) { size = d; best = h } }
    return { id: best.id, text: best.textContent.replace('#', '').trim(), size: Math.round(size) } })()`
  await check(label, 'table of contents, narrow: the bar comes in on scrolling up, names the section, opens on T, and goes there', async () => {
    const page = await browser.newPage({ width: 390, height: 800 })
    try {
      await page.goto(url)
      await sleep(500)
      expect(!(await shown(page)), 'the bar shows at the top of the post')
      const section = await page.evaluate(longest)
      await page.evaluate(`document.getElementById('${section.id}').scrollIntoView(); scrollBy(0, 200)`)
      await sleep(100)
      await page.evaluate('scrollBy(0, 300)')
      await sleep(400)
      expect(!(await shown(page)), 'the bar shows while the reader scrolls down')
      await page.evaluate('scrollBy(0, -150)')
      await sleep(400)
      expect(await shown(page), 'the bar does not come in when the reader scrolls up')
      const named = await page.evaluate(`${NAV}.querySelector('[data-toc-current]').textContent.trim()`)
      expect(named === section.text, `the bar names "${named}", the reader is in "${section.text}"`)
      await press(page, 't')
      await sleep(200)
      const entries = await page.evaluate(`[...${NAV}.querySelectorAll('.toc-list a')].filter((a) => a.offsetParent).length`)
      expect(entries >= 3, `T opened a list of ${entries} entries`)
      const target = await page.evaluate(`[...${NAV}.querySelectorAll('.toc-h2 a')].map((a) => a.getAttribute('href')).find((h) => h !== '#${section.id}' && h !== '#references-title')`)
      await page.evaluate(`${NAV}.querySelector('.toc-list a[href="${target}"]').click()`)
      await sleep(400)
      const landed = await page.evaluate(`(() => { const h = document.getElementById('${target.slice(1)}').getBoundingClientRect(); const n = ${NAV}; const bar = getComputedStyle(n).visibility === 'visible' ? n.getBoundingClientRect().bottom : 0; return { hash: location.hash, top: Math.round(h.top), bar: Math.round(bar), open: [...n.querySelectorAll('.toc-list a')].some((a) => a.offsetParent) } })()`)
      expect(landed.hash === target, `the entry ${target} went to ${landed.hash}`)
      expect(!landed.open, 'the list stays open after a choice')
      expect(landed.top >= landed.bar - 1 && landed.top < 200, `the heading lands at ${landed.top} px, the bar ends at ${landed.bar} px`)
      await press(page, 't')
      await page.evaluate(`${NAV}.querySelector('[aria-label="To Top"]').click()`)
      await sleep(300)
      expect(await page.evaluate('scrollY === 0'), 'To Top must return to the page top')
      expect(!(await shown(page)), 'To Top must close and hide the narrow bar')
      const home = await page.evaluate(`${NAV}.querySelector('[aria-label="Home"]').href === document.querySelector('.site-nav a').href`)
      expect(home, 'Home must link to the blog index')
      if (page.problems.length) throw new Error(page.problems.join('\n'))
      return { section: section.text, entries, landed }
    } finally {
      await page.close()
    }
  })
  await check(label, 'table of contents, wide: in the margin, marks the section on screen, folds on T, avoids wide figures', async () => {
    const page = await browser.newPage({ width: 1440, height: 900 })
    try {
      await page.goto(url)
      await sleep(500)
      expect(await shown(page), 'the list is not in the margin at the top of the post')
      const margin = await page.evaluate(`[Math.round(${NAV}.getBoundingClientRect().right), Math.round(document.querySelector('main > p').getBoundingClientRect().left)]`)
      expect(margin[0] <= margin[1] - 16, `the list ends at ${margin[0]} px, the text starts at ${margin[1]} px`)
      const section = await page.evaluate(longest)
      await page.evaluate(`document.getElementById('${section.id}').scrollIntoView(); scrollBy(0, 100)`)
      await sleep(300)
      const marked = await page.evaluate(`${NAV}.querySelector('[aria-current]')?.getAttribute('href')`)
      expect(marked === `#${section.id}`, `the list marks ${marked}, the reader is in #${section.id}`)
      await press(page, 't')
      await sleep(250)
      const folded = await page.evaluate(`[...${NAV}.querySelectorAll('.toc-list a')].filter((a) => a.offsetParent).length`)
      await press(page, 't')
      await sleep(250)
      const unfolded = await page.evaluate(`[...${NAV}.querySelectorAll('.toc-list a')].filter((a) => a.offsetParent).length`)
      expect(folded === 0 && unfolded > 0, `T folded the list to ${folded} entries and back to ${unfolded}`)
      // A figure wider than the text: keep the chosen position, and fade if it overlaps.
      const wide = await page.evaluate(`(() => { const r = ${NAV}.getBoundingClientRect().right; return [...document.querySelectorAll('main > *')].findIndex((el) => el.getBoundingClientRect().left < r) })()`)
      let beside = null
      if (wide >= 0) {
        await page.evaluate(`(() => { const el = document.querySelectorAll('main > *')[${wide}]; scrollBy(0, el.getBoundingClientRect().top - ${NAV}.getBoundingClientRect().top - 20) })()`)
        await sleep(300)
        if (await shown(page)) {
          const gap = await page.evaluate(`document.querySelectorAll('main > *')[${wide}].getBoundingClientRect().left - ${NAV}.getBoundingClientRect().right`)
          expect(gap >= 11, 'the visible list overlaps a wide figure')
        }
        await page.evaluate(`(() => { const el = document.querySelectorAll('main > *')[${wide}]; scrollBy(0, el.getBoundingClientRect().bottom + 20) })()`)
        await sleep(300)
        beside = await page.evaluate(`document.querySelectorAll('main > *')[${wide}].id || document.querySelectorAll('main > *')[${wide}].className`)
        const after = await page.evaluate(`(() => { const r = ${NAV}.getBoundingClientRect(); return [...document.querySelectorAll('main > *')].some((el) => { const b = el.getBoundingClientRect(); return b.left < r.right && b.bottom > r.top && b.top < r.bottom }) })()`)
        if (!after) expect(await shown(page), 'the list does not come back once the wide figure has passed')
      }
      if (page.problems.length) throw new Error(page.problems.join('\n'))
      return { marked, folded, unfolded, fadedBeside: beside }
    } finally {
      await page.close()
    }
  })
}

// A 64rem figure at each window width tests both sides of the fit threshold and a fixed position throughout scrolling.
export async function tocSpace({ check, browser, url, label }) {
  await check(label, 'table of contents stays beside the widest figure, falling back beside prose when necessary', async () => {
    const page = await browser.newPage({ width: 1920, height: 900 })
    try {
      await page.goto(url)
      await page.evaluate(`(() => {
        const figure = document.createElement('figure')
        figure.id = 'toc-space-check'
        figure.className = 'figure-wider'
        figure.style.height = '1200px'
        document.querySelector('main').append(figure)
        const tail = document.createElement('p')
        tail.style.height = '1600px'
        figure.after(tail)
        dispatchEvent(new Event('resize'))
      })()`)
      const seen = []
      for (const width of [1920, 1600, 1440, 1200, 1920]) {
        await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
        await page.evaluate('scrollTo(0, 0)')
        await sleep(300)
        const before = await page.evaluate(`${NAV}.getBoundingClientRect().left`)
        expect(before >= 23, 'the list must preserve its window margin')
        expect(await shown(page), 'the list must show before the wide figure')
        await page.evaluate(`document.getElementById('toc-space-check').scrollIntoView()`)
        await sleep(350)
        const boxes = await page.evaluate(`(() => {
          const n = ${NAV}.getBoundingClientRect(), f = document.getElementById('toc-space-check').getBoundingClientRect()
          return { left: n.left, right: n.right, figure: f.left, prose: document.querySelector('main > p').getBoundingClientRect().left }
        })()`)
        const visible = await shown(page)
        expect(Math.abs(boxes.left - before) < 1, 'scrolling beside a figure must not move the list sideways')
        if (width >= 1600) expect(visible && Math.abs(boxes.figure - boxes.right - 12) < 1, 'a roomy window must place the list 12px beside the widest figure')
        else {
          expect(!visible, 'the list must hide when it cannot fit beside the figure')
          expect(Math.abs(boxes.prose - boxes.right - 40) < 1, 'a narrower window must fall back to the prose-side position')
        }
        seen.push({ width, visible, ...boxes })
      }
      await page.evaluate('scrollTo(0, 0)')
      await sleep(300)
      expect(await shown(page), 'the list must return after the figure passes')
      expect(await page.evaluate(`Math.abs(${NAV}.getBoundingClientRect().left - ${seen.at(-1).left}) < 1`), 'the list must keep its position after the figure passes')
      return seen
    } finally { await page.close() }
  })
}
