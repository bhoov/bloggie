// The slide editor's overview (client.js): every slide of the deck as a thumbnail in a column on the
// left, as in a slide editor. Click one to show it. Drag one to move its slide: a line shows where it
// goes, the list scrolls when the pointer is near its top or bottom, and Esc cancels. With a
// thumbnail focused, ↑ ↓ move between slides, ⌘↑ ⌘↓ move the slide up or down, ⌘⇧↑ ⌘⇧↓ to the
// start or the end, ⌘D duplicates the slide and Delete deletes it; each thumbnail also has buttons
// for the last two.
//
// A thumbnail is a copy of the slide's elements, scaled down: it is drawn once when it scrolls into
// view, and again when the editor changes the slide. It is a picture only. Its figures are copies of
// what they show at that moment: an island is turned into a plain element so that it does not start
// a second figure, a canvas into an image of its pixels, and a video into its poster.

const STAGE_WIDTH = 1600
const THUMB_WIDTH = 176 // px on screen
const DRAG_START = 5 // px the pointer moves before a press on a thumbnail becomes a drag
const SCROLL_EDGE = 48 // px from the list's top or bottom where a drag scrolls it

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

export function createPanel({ deck, slides, onPick, onDuplicate, onDelete, onMove, current: shown }) {
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

  // Drag a thumbnail to move its slide. `gap` is where it would go: before thumbnail `gap`, or after
  // the last one. A drop sends one move; the list is drawn again after it, so this list takes no
  // second drag.
  const line = document.createElement('div')
  line.className = 'se-drop'
  let drag = null // { from, pointerId, x, y (where it started), clientY, moving, ghost, offset, scrolling }
  let moved = false
  let dropped = false // a drag just ended: the click that follows it picks no slide
  const gapAt = (clientY) => {
    const i = items.findIndex((item) => { const r = item.getBoundingClientRect(); return clientY < r.top + r.height / 2 })
    return i < 0 ? items.length : i
  }
  // The move a drop at `gap` makes, or null where the slide would stay.
  const target = (gap) => (gap === drag.from || gap === drag.from + 1 ? null : gap > drag.from ? gap - 1 : gap)
  const place = () => {
    const gap = gapAt(drag.clientY)
    if (target(gap) === null) return line.remove()
    const below = items[gap]
    const above = items[gap - 1]
    line.style.top = `${below ? below.offsetTop : above.offsetTop + above.offsetHeight}px`
    if (!line.isConnected) panel.append(line)
  }
  const autoscroll = () => {
    if (!drag?.moving) return
    const r = panel.getBoundingClientRect()
    const top = head.getBoundingClientRect().bottom
    const dy = drag.clientY < top + SCROLL_EDGE ? -(top + SCROLL_EDGE - drag.clientY) : drag.clientY > r.bottom - SCROLL_EDGE ? drag.clientY - (r.bottom - SCROLL_EDGE) : 0
    if (dy) { panel.scrollTop += dy / 3; place() }
    drag.scrolling = requestAnimationFrame(autoscroll)
  }
  const endDrag = () => {
    if (!drag) return
    cancelAnimationFrame(drag.scrolling)
    drag.ghost?.remove()
    line.remove()
    items[drag.from].classList.remove('se-dragged')
    panel.classList.remove('se-dragging')
    window.removeEventListener('keydown', onEscape, true)
    drag = null
  }
  const onEscape = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    endDrag()
  }
  panel.addEventListener('pointerdown', (event) => {
    const item = event.target.closest('.se-slide')
    if (!item || event.button !== 0 || event.target.closest('button') || moved) return
    drag = { from: Number(item.dataset.index), pointerId: event.pointerId, x: event.clientX, y: event.clientY, moving: false }
  })
  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.clientY = event.clientY
    if (!drag.moving) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_START) return
      drag.moving = true
      panel.setPointerCapture(event.pointerId)
      const item = items[drag.from]
      item.classList.add('se-dragged')
      panel.classList.add('se-dragging')
      const frame = item.querySelector('.se-slide-frame')
      const r = frame.getBoundingClientRect()
      drag.ghost = frame.cloneNode(true)
      drag.ghost.classList.add('se-ghost')
      drag.offset = [drag.x - r.left, drag.y - r.top]
      panel.append(drag.ghost)
      window.addEventListener('keydown', onEscape, true)
      drag.scrolling = requestAnimationFrame(autoscroll)
    }
    drag.ghost.style.translate = `${event.clientX - drag.offset[0]}px ${event.clientY - drag.offset[1]}px`
    place()
  })
  panel.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const to = drag.moving ? target(gapAt(event.clientY)) : null
    const { from, moving } = drag
    endDrag()
    if (!moving) return
    dropped = true
    setTimeout(() => { dropped = false })
    if (to === null) return
    moved = true
    // Show the order at once; the editor draws the list again from the new render.
    const item = items[from]
    const others = items.filter((x) => x !== item)
    if (to < others.length) others[to].before(item)
    else others.at(-1).after(item)
    onMove(from, to)
  })
  panel.addEventListener('pointercancel', endDrag)

  let current = -1
  panel.addEventListener('click', (event) => {
    const item = event.target.closest('.se-slide')
    if (!item || dropped) return
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
    const up = ['ArrowUp', 'ArrowLeft'].includes(event.key)
    const down = ['ArrowDown', 'ArrowRight'].includes(event.key)
    if (mod && (up || down)) {
      handled()
      const to = event.shiftKey ? (up ? 0 : items.length - 1) : current + (up ? -1 : 1)
      if (!moved && current >= 0 && to >= 0 && to < items.length && to !== current) { moved = true; onMove(current, to) }
    } else if (up && current > 0) { handled(); onPick(current - 1); items[current - 1].focus() }
    else if (down && current < items.length - 1) { handled(); onPick(current + 1); items[current + 1].focus() }
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
      endDrag()
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
