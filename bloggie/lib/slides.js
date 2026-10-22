// A small slide engine for layouts/slides.html. One <section class="slide"> shows at a time on
// a fixed 1600×900 stage, scaled to fit the window. Within a slide, "steps" reveal in order:
// every element with class `step`, and every <li> of a slide marked `data-build`. The elements that match the
// selector in a block's data-steps (e.g. a table's tr:has(.baseline)) are one step together.
//
// Keys: → / Space / PageDown next · ← / PageUp previous · Home / End · F fullscreen ·
// N notes · P speaker view · Esc back to the post (from the speaker view: close it). Keys typed into a figure's controls (sliders, buttons, the
// energy scrubber) stay with the figure. The position is in the URL hash (#3.2 = slide 3,
// two steps shown), so a reload or a shared link keeps it. A presenter window (?presenter)
// shows the notes, the next slide's title and a clock, and follows the same position.

const STAGE = { width: 1600, height: 900 }

export function initDeck(deck) {
  const slides = [...deck.querySelectorAll(':scope > section.slide, :scope > .slide')]
  slides.forEach((slide, i) => {
    if (slide.hasAttribute('data-build')) slide.querySelectorAll('li').forEach((li) => li.classList.add('step'))
    slide.querySelectorAll('[data-steps]').forEach((block, j) => block.querySelectorAll(block.dataset.steps).forEach((el) => {
      el.classList.add('step')
      el.dataset.stepGroup = `${i}-${j}`
    }))
  })
  // A step: one element with class `step`, or the consecutive ones that share a data-step-group.
  const stepsOf = (slide) => [...slide.querySelectorAll('.step')].reduce((steps, el) => {
    const last = steps.at(-1)
    if (el.dataset.stepGroup && last?.[0].dataset.stepGroup === el.dataset.stepGroup) last.push(el)
    else steps.push([el])
    return steps
  }, [])
  const notesOf = (slide) => slide.querySelector('aside.notes')?.innerHTML ?? ''
  const titleOf = (slide) => slide.dataset.title ?? slide.querySelector('h1, h2')?.textContent ?? ''

  let presenter = new URLSearchParams(location.search).has('presenter')
  document.body.classList.toggle('presenter-mode', presenter)
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`deck:${location.pathname}`) : null

  const count = document.querySelector('.deck-count')
  const progress = document.querySelector('.deck-progress > div')
  const notesPanel = document.querySelector('.deck-notes')
  let index = 0
  let step = 0

  const parseHash = () => {
    const [i, s] = location.hash.slice(1).split('.').map(Number)
    return { i: Number.isInteger(i) ? Math.max(0, Math.min(slides.length - 1, i - 1)) : 0, s: Number.isInteger(s) ? s : 0 }
  }

  function show(i, s, { broadcast = true } = {}) {
    index = Math.max(0, Math.min(slides.length - 1, i))
    const steps = stepsOf(slides[index])
    step = Math.max(0, Math.min(steps.length, s))
    slides.forEach((slide, k) => {
      slide.classList.toggle('active', k === index)
      slide.classList.toggle('before', k < index)
      slide.classList.toggle('after', k > index)
      slide.setAttribute('aria-hidden', String(k !== index))
      slide.inert = k !== index
      // A video keeps playing only on its own slide.
      if (k !== index) slide.querySelectorAll('video').forEach((v) => v.pause())
    })
    steps.forEach((els, k) => els.forEach((el) => el.classList.toggle('shown', k < step)))
    count.textContent = `${index + 1} / ${slides.length}`
    progress.style.width = `${(100 * (index + (steps.length ? step / steps.length : 1))) / slides.length}%`
    notesPanel.innerHTML = notesOf(slides[index])
    if (presenter) renderPresenter()
    history.replaceState(null, '', `#${index + 1}${step ? `.${step}` : ''}`)
    if (broadcast) channel?.postMessage({ index, step })
  }

  const next = () => {
    if (step < stepsOf(slides[index]).length) show(index, step + 1)
    else if (index < slides.length - 1) show(index + 1, 0)
  }
  const prev = () => {
    if (step > 0) show(index, step - 1)
    else if (index > 0) show(index - 1, stepsOf(slides[index - 1]).length)
  }

  // Esc returns to the post. If the reader came from it, go Back, so the post keeps its scroll
  // position; otherwise load it. Esc first closes the notes panel, and does nothing in the
  // presenter window, which has no post to return to. (In full screen, the browser uses Esc to
  // leave full screen, and the page does not see it.)
  const postHref = deck.dataset.post
  const exitDeck = ({ closeNotesFirst = true } = {}) => {
    if (closeNotesFirst && !notesPanel.hidden) { notesPanel.hidden = true; return }
    if (presenter) return leaveSpeakerView()
    if (!postHref) return
    const post = new URL(postHref, location.href)
    const cameFromPost = document.referrer && new URL(document.referrer).pathname === post.pathname
    if (cameFromPost && history.length > 1) history.back()
    else location.href = post.href
  }

  // A focused control keeps the keys it uses. Text fields, sliders, selects and videos use the
  // arrows, Space, Home and End; a button, a <summary>, a checkbox or a clickable node uses only
  // Space and Enter, so the arrows still move the deck after a figure's button is clicked.
  const ALL_KEYS = 'input:not([type="checkbox"], [type="radio"], [type="button"]), select, textarea, [role="slider"], [contenteditable], video'
  const PRESS_KEYS = 'button, summary, a[href], input[type="checkbox"], input[type="radio"], [role="button"]'
  const ownsKey = (target, key) => target instanceof Element &&
    (target.closest(ALL_KEYS) || ((key === ' ' || key === 'Enter') && target.closest(PRESS_KEYS)))
  // Present: this window goes full screen for the room. The stage fills the screen; the cursor
  // shows while the mouse moves, and the nav only while the mouse is at the bottom of the screen.
  // The browser takes Esc to leave full screen; ✕ does the same.
  const toggleFullscreen = () => {
    notesPanel.hidden = true
    return (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      ?.catch(() => {}) // refused (e.g. inside an iframe): stay windowed
  }
  const presentButton = document.querySelector('[data-deck="present"]')
  const exitLink = document.querySelector('[data-deck="exit"]')
  const nav = document.querySelector('.deck-nav')
  const NAV_BAND = 80 // px at the bottom of the screen where the pointer shows the nav in full screen
  let cursorTimer = null
  let navTimer = null
  const showCursor = () => {
    document.body.classList.add('pointer-visible')
    clearTimeout(cursorTimer)
    cursorTimer = setTimeout(() => document.body.classList.remove('pointer-visible'), 2000)
  }
  // The nav goes when the pointer leaves the bottom, or rests there a while, unless it is on the nav.
  const hideNav = () => {
    if (nav?.matches(':hover')) navTimer = setTimeout(hideNav, 1000)
    else document.body.classList.remove('chrome-visible')
  }
  document.addEventListener('fullscreenchange', () => {
    const full = !!document.fullscreenElement
    document.body.classList.toggle('is-fullscreen', full)
    document.body.classList.remove('chrome-visible')
    if (presentButton) presentButton.textContent = full ? 'Exit full screen' : '▶ Present'
    if (exitLink) exitLink.title = full ? 'Leave full screen (Esc)' : 'Back to the post (Esc)'
    if (full) showCursor()
  })
  document.addEventListener('pointermove', (event) => {
    if (!document.fullscreenElement) return
    showCursor()
    clearTimeout(navTimer)
    if (event.clientY >= innerHeight - NAV_BAND) {
      document.body.classList.add('chrome-visible')
      navTimer = setTimeout(hideNav, 3000)
    } else if (document.body.classList.contains('chrome-visible')) navTimer = setTimeout(hideNav, 400)
  })
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    // Esc leaves the deck from anywhere except a text field or an open select.
    if (event.key === 'Escape') {
      if (event.target instanceof Element && event.target.closest('textarea, select, [contenteditable], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"])')) return
      event.preventDefault()
      return exitDeck()
    }
    // A deck nav button does not keep Space: the deck advances once and cancels the button's own click.
    if (ownsKey(event.target, event.key) && !event.target.closest('.deck-nav')) return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key // F, N, P work with Shift or Caps Lock
    const actions = {
      ArrowRight: next, PageDown: next, ' ': next,
      ArrowLeft: prev, PageUp: prev,
      Home: () => show(0, 0),
      End: () => show(slides.length - 1, stepsOf(slides.at(-1)).length),
      f: toggleFullscreen,
      n: () => { notesPanel.hidden = !notesPanel.hidden },
      p: openSpeakerView,
    }
    const action = actions[key]
    if (!action) return
    event.preventDefault()
    action()
  })

  document.querySelector('[data-deck="next"]').addEventListener('click', next)
  document.querySelector('[data-deck="prev"]').addEventListener('click', prev)
  document.querySelector('[data-deck="notes"]').addEventListener('click', () => { notesPanel.hidden = !notesPanel.hidden })
  document.querySelector('[data-deck="presenter"]').addEventListener('click', openSpeakerView)
  presentButton?.addEventListener('click', toggleFullscreen)
  // ✕ does what Esc does: out of full screen when presenting, else back to the post. (The slide
  // editor, under `npm run dev`, takes it first to stop editing.)
  exitLink?.addEventListener('click', (event) => {
    event.preventDefault()
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {})
    exitDeck({ closeNotesFirst: false })
  })

  // Speaker view: a second window (?presenter) with the notes, what comes next and a clock. It
  // follows the deck and drives it: keys pressed in either window move both.
  function openSpeakerView() {
    if (presenter) return
    const url = new URL(location.href)
    url.searchParams.set('presenter', '')
    window.open(url, 'deck-presenter', 'width=1400,height=900')
  }
  // Esc in the speaker view: close it if the deck opened it; if it was loaded on its own, turn
  // it into the plain deck in place.
  function leaveSpeakerView() {
    if (window.opener && !window.opener.closed) { window.close(); return }
    presenter = false
    document.body.classList.remove('presenter-mode')
    clearInterval(clockTimer)
    presenterPanel?.remove()
    presenterPanel = null
    const url = new URL(location.href)
    url.searchParams.delete('presenter')
    history.replaceState(null, '', url)
  }

  channel?.addEventListener('message', ({ data }) => show(data.index, data.step, { broadcast: false }))

  // Presenter view: the stage on the left, the notes, next title and a clock on the right.
  let presenterPanel = null
  let clockTimer = null
  const started = Date.now()
  const elapsed = () => {
    const s = Math.floor((Date.now() - started) / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  function renderPresenter() {
    if (!presenterPanel) {
      presenterPanel = document.createElement('aside')
      presenterPanel.className = 'presenter-panel'
      document.body.append(presenterPanel)
      clockTimer = setInterval(() => {
        const clock = presenterPanel?.querySelector('.presenter-clock')
        if (clock) clock.textContent = elapsed()
      }, 1000)
    }
    const steps = stepsOf(slides[index]).length
    const upcoming = step < steps ? `step ${step + 1} of ${steps} on this slide` : slides[index + 1] ? `next: ${titleOf(slides[index + 1])}` : 'last slide'
    presenterPanel.innerHTML = `<div class="presenter-head"><b>Speaker view</b><span>Esc closes it. Keys here move the audience window too.</span></div>
      <div class="presenter-clock">${elapsed()}</div>
      <div class="presenter-next">${upcoming}</div>
      <div class="presenter-notes">${notesOf(slides[index]) || '<em>No notes.</em>'}</div>`
  }

  // Scale the stage to the window, letterboxed.
  const viewport = document.querySelector('.deck-viewport')
  function fit() {
    const box = viewport.getBoundingClientRect()
    const scale = Math.min(box.width / STAGE.width, box.height / STAGE.height)
    deck.style.transform = `translate(-50%, -50%) scale(${scale})`
  }
  new ResizeObserver(fit).observe(viewport)
  fit()

  window.addEventListener('hashchange', () => {
    const { i, s } = parseHash()
    if (i !== index || s !== step) show(i, s)
  })
  // The slide editor (bloggie/editor/, `npm run dev` only) adds and removes slides in place; after it
  // does, it sends deck:slides with the slide to show, and the deck reads its slides again.
  deck.addEventListener('deck:slides', (event) => {
    slides.splice(0, slides.length, ...deck.querySelectorAll(':scope > section.slide, :scope > .slide'))
    slides.forEach((slide) => {
      if (slide.hasAttribute('data-build')) slide.querySelectorAll('li').forEach((li) => li.classList.add('step'))
    })
    show(event.detail?.index ?? index, 0)
  })
  const { i, s } = parseHash()
  show(i, s)
}
