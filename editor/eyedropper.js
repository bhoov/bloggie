// The slide editor's eyedropper (client.js): take the color of anything on the page.
//
// While it is open, a layer over the whole window takes the pointer, so a click picks a color and
// does nothing else (the slide list, the figures and the nav do not see it). A loupe beside the
// pointer shows the place under it magnified, with the color there and its name when it is a theme
// color. Click takes the color; Esc, or a right-click, puts the eyedropper away.
//
// The color is the one the page draws there, read from the element rather than the screen (a page
// cannot read the screen's pixels): the text color over a letter, the fill of an SVG shape, the
// color of the pixel of an image, canvas or video, else the background. So a theme color comes back
// exactly as the theme has it, and the editor can write it by the theme's name.
const SVG = 'http://www.w3.org/2000/svg'
const ZOOM = 6 // how much the loupe magnifies
const SIZE = 140 // the loupe's diameter, in screen px
const CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16"><path d="M11.2 1.8a2 2 0 0 1 2.9 2.9l-1.6 1.6.7.7-1.1 1.1-.7-.7-5.6 5.6H3.6v-2.2l5.6-5.6-.7-.7 1.1-1.1.7.7z" fill="white" stroke="black" stroke-width="1"/></svg>')}") 3 21, crosshair`

const clear = (color) => !color || color === 'transparent' || /rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(color) || color === 'none'

// The pixel of an image, a canvas or a video frame under (x, y), as rgb(); null if it cannot be read.
function pixelOf(el, x, y) {
  const r = el.getBoundingClientRect()
  const w = el.naturalWidth || el.videoWidth || el.width
  const h = el.naturalHeight || el.videoHeight || el.height
  if (!w || !h || !r.width || !r.height) return null
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  try {
    const context = canvas.getContext('2d')
    context.drawImage(el, ((x - r.left) / r.width) * w, ((y - r.top) / r.height) * h, 1, 1, 0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    return alpha ? `rgb(${red}, ${green}, ${blue})` : null
  } catch {
    return null // an image from another origin taints the canvas
  }
}

// Whether (x, y) is on a letter of a text node: the box of the character under it holds the point.
function onLetter(x, y) {
  const position = document.caretPositionFromPoint?.(x, y)
  const range = position ? document.createRange() : document.caretRangeFromPoint?.(x, y)
  if (position) {
    if (!position.offsetNode) return null
    range.setStart(position.offsetNode, position.offset)
  }
  const node = range?.startContainer
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  for (const offset of [range.startOffset, range.startOffset - 1]) {
    if (offset < 0 || offset >= node.length) continue
    const letter = document.createRange()
    letter.setStart(node, offset)
    letter.setEnd(node, offset + 1)
    for (const box of letter.getClientRects()) if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return node.parentElement
  }
  return null
}

// The color the page draws at (x, y), below the eyedropper's own layer.
export function colorAt(x, y) {
  const letter = onLetter(x, y)
  if (letter && !clear(getComputedStyle(letter).color)) return getComputedStyle(letter).color
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement || el instanceof HTMLVideoElement) {
      const pixel = pixelOf(el, x, y)
      if (pixel) return pixel
    }
    const cs = getComputedStyle(el)
    if (el.namespaceURI === SVG && el.localName !== 'svg') {
      if (!clear(cs.fill)) return cs.fill
      if (!clear(cs.stroke)) return cs.stroke
      continue
    }
    if (!clear(cs.backgroundColor)) return cs.backgroundColor
  }
  return getComputedStyle(document.body).backgroundColor
}

// Pick a color. `nameOf(color)` gives a theme color's name for the loupe (or null); `magnify` is the
// still copies of the page to magnify, each where the page has it (a copy with data-se-scroll keeps
// that scroll position). Resolves to the color (rgb(), as the page computes it), or to null if the
// eyedropper was put away.
export function pickColor({ nameOf = () => null, magnify = [] } = {}) {
  return new Promise((resolve) => {
    const layer = document.createElement('div')
    layer.className = 'se-eyedrop'
    layer.style.cursor = CURSOR
    const loupe = document.createElement('div')
    loupe.className = 'se-loupe'
    loupe.innerHTML = '<div class="se-loupe-view"><div class="se-loupe-page"></div><span class="se-loupe-aim"></span></div><div class="se-loupe-chip"><span class="se-loupe-swatch"></span><span class="se-loupe-name"></span></div>'
    // The magnified view: still copies of the parts of the page worth magnifying (the stage), in
    // their places on the page, scaled around the pointer.
    const page = loupe.querySelector('.se-loupe-page')
    Object.assign(page.style, { width: `${innerWidth}px`, height: `${innerHeight}px`, background: getComputedStyle(document.body).backgroundColor })
    for (const el of magnify) if (el) page.append(el)
    document.body.append(layer, loupe)
    for (const el of page.querySelectorAll('[data-se-scroll]')) el.scrollTop = Number(el.dataset.seScroll)
    let color = null
    const show = (x, y) => {
      layer.style.pointerEvents = 'none' // look under the layer
      color = colorAt(x, y)
      layer.style.pointerEvents = ''
      page.style.transform = `translate(${SIZE / 2 - x * ZOOM}px, ${SIZE / 2 - y * ZOOM}px) scale(${ZOOM})`
      loupe.querySelector('.se-loupe-swatch').style.background = color
      loupe.querySelector('.se-loupe-name').textContent = nameOf(color) ?? hex(color)
      // beside the pointer, inside the window
      const left = x + 24 + SIZE > innerWidth ? x - 24 - SIZE : x + 24
      const top = y + 24 + SIZE + 34 > innerHeight ? y - 24 - SIZE - 34 : y + 24
      Object.assign(loupe.style, { left: `${left}px`, top: `${top}px`, display: 'block' })
    }
    const finish = (value) => {
      layer.remove()
      loupe.remove()
      window.removeEventListener('keydown', key, true)
      resolve(value)
    }
    const key = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') finish(null)
    }
    layer.addEventListener('pointermove', (event) => show(event.clientX, event.clientY))
    layer.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.button !== 0) return finish(null)
      show(event.clientX, event.clientY)
      finish(color)
    })
    // The click that follows, and any other, stays on the layer: nothing under it reacts.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu']) layer.addEventListener(type, (event) => { event.preventDefault(); event.stopPropagation() })
    window.addEventListener('keydown', key, true)
  })
}

// rgb(a, b, c) as #aabbcc.
export function hex(color) {
  const [r, g, b] = (String(color).match(/\d+(\.\d+)?/g) ?? []).map(Number)
  if (![r, g, b].every(Number.isFinite)) return String(color)
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}
