// A post's table of contents (Post.astro's <nav data-toc>), built in the page from its headings: every h2 and h3 with an
// id is listed, so a section needs nothing but its id. It takes one of two forms, by the width of the page
// (site.css, "table of contents"):
//   wide (75rem and more): a list in the margin left of the text, always there. It marks the current section and lists
//     the subsections of that section only. It sits beside the page's widest figure if that fits; otherwise beside the
//     prose, fading while an overlapping figure passes. Its horizontal position does not change with scrolling.
//   narrow: a bar at the top that names the current section. It comes in when the reader scrolls up, once past the
//     post's header, and goes when they scroll down; a tap on it opens the list.
// T toggles it: on a wide page it folds the list away (remembered), on a narrow one it opens the bar's list. Esc
// closes the bar's list. A post with fewer than three sections, or with `toc: false`, has none.

const WIDE = matchMedia('(min-width: 75rem)')
const LEAST = 3 // sections
const FOLDED = 'toc-folded' // localStorage key

export function initToc(nav) {
  const list = nav.querySelector('[data-toc-list]')
  const toggle = nav.querySelector('[data-toc-toggle]')
  const current = nav.querySelector('[data-toc-current]')
  const main = document.querySelector('main')
  let entries = [] // { heading, item, link, level, parent }
  let beside = [] // the blocks of the post that reach into the margin, where the wide list is
  let offset = 0 // fixed distance left of the prose-side position, chosen for the page's full width
  let lastY = scrollY
  let open = false
  let folded = false
  try { folded = localStorage.getItem(FOLDED) === '1' } catch {}

  function rebuild() {
    const headings = [...main.querySelectorAll(':scope > :is(h2, h3)[id], :scope > .addendum > :is(h2, h3)[id], :scope > .references h2[id]')]
    nav.hidden = headings.filter((h) => h.localName === 'h2').length < LEAST
    let parent = null
    entries = headings.map((heading) => {
      const level = heading.localName === 'h2' ? 2 : 3
      const item = document.createElement('li')
      item.className = `toc-h${level}`
      const link = document.createElement('a')
      link.href = `#${heading.id}`
      link.append(...words(heading))
      item.append(link)
      const entry = { heading, item, link, level, parent: level === 2 ? null : parent }
      if (level === 2) parent = entry
      return entry
    })
    list.replaceChildren(...entries.map((e) => e.item))
    measure()
  }

  // A heading's words, as the post draws them (math included), without its # anchor, links or ids.
  function words(heading) {
    const copy = heading.cloneNode(true)
    copy.querySelectorAll('.heading-anchor').forEach((el) => el.remove())
    copy.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes))
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    const nodes = [...copy.childNodes]
    while (nodes.length && nodes.at(-1).nodeType === Node.TEXT_NODE && !nodes.at(-1).textContent.trim()) nodes.pop()
    return nodes
  }

  // Choose one position for the whole page. Reserve space for its widest block if the list still fits in the window.
  function measure() {
    if (!WIDE.matches || nav.hidden) {
      beside = []
      offset = 0
      nav.style.removeProperty('--toc-offset')
      update()
      return
    }
    const box = nav.getBoundingClientRect()
    const right = box.right + offset
    const left = box.left + offset
    // A figure put straight into the post is an island with no box of its own (display: contents): measure its figure.
    const blocks = [...main.children]
      .map((el) => (getComputedStyle(el).display === 'contents' ? el.firstElementChild : el))
      .map((el) => ({ el, box: el?.getBoundingClientRect() }))
      .filter(({ box }) => box && box.width > 0)
    const needed = Math.max(0, ...blocks.map(({ box }) => right - box.left + 12))
    offset = left - needed >= 24 ? needed : 0
    nav.style.setProperty('--toc-offset', `${offset}px`)
    beside = blocks.filter(({ box }) => box.left < right - offset + 12).map(({ el }) => el)
    update()
  }

  // The current section: the last heading above a line a third of the way down the screen, or, at the end of the
  // page, the last one on screen.
  function now() {
    const line = Math.min(innerHeight / 3, 220)
    const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2
    let at = null
    for (const e of entries) {
      const top = e.heading.getBoundingClientRect().top
      if (top <= line || (end && top < innerHeight)) at = e
      else if (!end) break
    }
    return at
  }

  let frame = 0
  function update() {
    frame = 0
    if (nav.hidden) return
    const at = now()
    const section = at?.parent ?? at
    for (const e of entries) {
      if (e === at) e.link.setAttribute('aria-current', 'location')
      else e.link.removeAttribute('aria-current')
      e.item.classList.toggle('toc-in', e.level === 2 || (section !== null && e.parent === section))
    }
    current.replaceChildren(...(section ? [...section.link.cloneNode(true).childNodes] : [document.querySelector('h1')?.textContent ?? '']))
    nav.classList.toggle('toc-folded', WIDE.matches && folded)

    if (WIDE.matches) {
      // Keep the current entry in view. Fade on overlap without changing the page's chosen horizontal position.
      if (at) {
        const top = at.item.offsetTop - list.offsetTop
        if (top < list.scrollTop) list.scrollTop = top - 8
        else if (top + at.item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + at.item.offsetHeight - list.clientHeight + 8
      }
      const box = nav.getBoundingClientRect()
      nav.classList.toggle('toc-covered', beside.some((el) => { const b = el.getBoundingClientRect(); return b.bottom > box.top && b.top < box.bottom }))
      nav.classList.remove('toc-shown')
    } else {
      // The bar: in when the reader scrolls up past the header, or while its list is open; out when they scroll down.
      const past = document.querySelector('.article-header')?.getBoundingClientRect().bottom < 0
      const y = scrollY
      if (open) nav.classList.add('toc-shown')
      else if (!past || y > lastY + 4) nav.classList.remove('toc-shown')
      else if (y < lastY - 4) nav.classList.add('toc-shown')
      if (Math.abs(y - lastY) > 4 || !past) lastY = y
      nav.classList.remove('toc-covered')
    }
    toggle.setAttribute('aria-expanded', String(WIDE.matches ? !folded : open))
  }
  const later = () => { if (!frame) frame = requestAnimationFrame(update) }

  function setOpen(value) {
    open = value
    nav.classList.toggle('toc-open', open)
    update()
  }
  function flip() {
    if (WIDE.matches) {
      folded = !folded
      try { localStorage.setItem(FOLDED, folded ? '1' : '0') } catch {}
      update()
    } else setOpen(!open)
  }

  toggle.addEventListener('click', flip)
  // A navigation link closes the bar's list; the link itself goes to its destination.
  nav.addEventListener('click', (event) => { if (event.target.closest('a') && open) setOpen(false) })
  document.addEventListener('click', (event) => { if (open && !nav.contains(event.target)) setOpen(false) })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) { setOpen(false); return }
    if (event.key.toLowerCase() !== 't' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]')) return
    if (nav.hidden) return
    event.preventDefault()
    flip()
  })
  addEventListener('scroll', later, { passive: true })
  addEventListener('resize', () => { if (open && WIDE.matches) setOpen(false); measure() })
  WIDE.addEventListener('change', measure)
  // Figures that hydrate, and fonts that load, move the blocks: measure again once the page has settled.
  addEventListener('load', measure)
  const sizes = new ResizeObserver(measure)
  sizes.observe(main)
  sizes.observe(nav)

  rebuild()
  return { rebuild }
}
