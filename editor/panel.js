// The slide editor's overview (client.js): every slide of the deck as a thumbnail in a column on the
// left, as in a slide editor. Click one to show it. With a thumbnail focused, ↑ ↓ move between
// slides, ⌘D duplicates the slide and Delete deletes it; each thumbnail also has buttons for both.
//
// A thumbnail is a copy of the slide's elements, scaled down: it is drawn once when it scrolls into
// view, and again when the editor changes the slide. It is a picture only. Its figures are copies of
// what they show at that moment: an island is turned into a plain element so that it does not start
// a second figure, a canvas into an image of its pixels, and a video into its poster.

const STAGE_WIDTH = 1600
const THUMB_WIDTH = 176 // px on screen

// A copy of a slide that shows it and runs nothing.
function snapshot(slide) {
  const copy = stillCopy(slide)
  copy.classList.remove('before', 'after')
  copy.classList.add('active')
  copy.removeAttribute('aria-hidden')
  copy.inert = true
  return copy
}

// A copy of an element that looks the same and runs nothing (also the eyedropper's magnified view).
export function stillCopy(element) {
  const copy = element.cloneNode(true)
  const canvases = [...element.querySelectorAll('canvas')]
  copy.querySelectorAll('canvas').forEach((canvas, i) => {
    const img = document.createElement('img')
    try { img.src = canvases[i].toDataURL() } catch {}
    img.style.cssText = `width: ${canvases[i].clientWidth}px; height: ${canvases[i].clientHeight}px`
    canvas.replaceWith(img)
  })
  copy.querySelectorAll('video').forEach((video) => {
    const img = document.createElement('img')
    if (video.poster) img.src = video.poster
    img.className = video.className
    video.replaceWith(img)
  })
  // A copy of a block's <style data-box> would turn its rules back on after the editor has taken
  // them over; the rules still reach the copy, by the ids it keeps.
  copy.querySelectorAll('script, style, template, aside.notes').forEach((el) => el.remove())
  // Astro islands, as plain elements: connected, an island would load and start its figure again.
  copy.querySelectorAll('astro-island, astro-slot, astro-static-slot').forEach((island) => {
    const plain = document.createElement('div')
    plain.style.display = 'contents'
    plain.append(...island.childNodes)
    island.replaceWith(plain)
  })
  return copy
}

export function createPanel({ deck, slides, onPick, onDuplicate, onDelete, current: shown }) {
  const panel = document.createElement('aside')
  panel.className = 'se-panel'
  panel.setAttribute('aria-label', 'Slides')
  // The slide on the stage: duplicate it, delete it.
  const head = document.createElement('div')
  head.className = 'se-panel-head'
  head.innerHTML = `<span>Slides</span><button type="button" data-act="duplicate" title="Duplicate the slide on the stage (⌘D in this list)">Duplicate</button><button type="button" data-act="delete" title="Delete the slide on the stage (Delete in this list)">Delete</button>`
  head.addEventListener('click', (event) => {
    const act = event.target.closest('button[data-act]')?.dataset.act
    if (act === 'duplicate') onDuplicate(shown())
    if (act === 'delete') onDelete(shown())
  })
  panel.append(head)
  const scale = THUMB_WIDTH / STAGE_WIDTH
  const items = slides.map((slide, i) => {
    const item = document.createElement('div')
    item.className = 'se-slide'
    item.tabIndex = -1
    item.dataset.index = i
    item.title = `${i + 1}. ${slide.dataset.title ?? ''}`
    item.innerHTML = `<span class="se-slide-n">${i + 1}</span>
      <div class="se-slide-frame" style="width: ${THUMB_WIDTH}px; height: ${THUMB_WIDTH * (9 / 16)}px"><div class="se-slide-stage" style="transform: scale(${scale})"></div></div>
      <span class="se-slide-tools"><button type="button" data-act="duplicate" title="Duplicate this slide (⌘D)">⧉</button><button type="button" data-act="delete" title="Delete this slide (Delete)">✕</button></span>`
    panel.append(item)
    return item
  })
  const drawn = new Set()
  const draw = (i) => {
    const stage = items[i].querySelector('.se-slide-stage')
    stage.replaceChildren(snapshot(slides[i]))
    stage.style.background = getComputedStyle(deck).backgroundColor
    drawn.add(i)
  }
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting && !drawn.has(Number(entry.target.dataset.index))) draw(Number(entry.target.dataset.index))
  }, { root: panel, rootMargin: '200px 0px' })

  let current = -1
  panel.addEventListener('click', (event) => {
    const item = event.target.closest('.se-slide')
    if (!item) return
    const i = Number(item.dataset.index)
    const act = event.target.closest('button[data-act]')?.dataset.act
    if (act === 'duplicate') return onDuplicate(i)
    if (act === 'delete') return onDelete(i)
    item.focus()
    onPick(i)
  })
  panel.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey
    const handled = () => { event.preventDefault(); event.stopPropagation() }
    if (['ArrowUp', 'ArrowLeft'].includes(event.key) && current > 0) { handled(); onPick(current - 1); items[current - 1].focus() }
    else if (['ArrowDown', 'ArrowRight'].includes(event.key) && current < items.length - 1) { handled(); onPick(current + 1); items[current + 1].focus() }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && !mod) { handled(); onDelete(current) }
    else if (mod && event.code === 'KeyD') { handled(); onDuplicate(current) }
    else if (event.key.startsWith('Arrow')) handled()
  })

  return {
    element: panel,
    show() {
      document.body.append(panel)
      items.forEach((item) => seen.observe(item))
    },
    hide() {
      seen.disconnect()
      panel.remove()
    },
    // The slide shown on the stage.
    mark(i) {
      if (i === current) return
      items[current]?.classList.remove('se-current')
      current = i
      items[i]?.classList.add('se-current')
      items[i]?.scrollIntoView({ block: 'nearest' })
    },
    // Draw a slide's thumbnail again, after an edit.
    refresh(i) { if (drawn.has(i)) draw(i) },
    focus(i = current) { items[i]?.focus() },
  }
}
