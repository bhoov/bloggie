// When a figure is on screen, for the figures that animate only while a reader can see them.
// In a post that is when the figure is in the viewport. A deck (bloggie/lib/slides.js) stacks every slide
// in one place and hides the inactive ones with opacity and visibility, which an IntersectionObserver
// does not see: there a figure is on screen only while its slide is the active one.
//
//   const unwatch = watchVisible(root, (visible) => { ... })   // in onMount; call unwatch() on destroy

export function watchVisible(element, onChange) {
  const slide = element.closest('.deck > .slide')
  let inViewport = false
  const update = () => {
    const visible = inViewport && (!slide || slide.classList.contains('active'))
    element.dataset.onScreen = String(visible) // for the end-to-end checks: what the figure believes
    onChange(visible)
  }
  const io = new IntersectionObserver(([entry]) => {
    inViewport = entry.isIntersecting
    update()
  })
  io.observe(element)
  // An IntersectionObserver reports only a change it sees, and it can keep an old "not on screen" for a figure that is
  // now on screen (after the window changed size, or a tab went full screen), so the figure would never move. So
  // measure again when the window changes, and whenever the reader uses the figure: a figure being clicked is on screen.
  const measure = () => {
    const r = element.getBoundingClientRect()
    inViewport = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    update()
  }
  const events = [[window, 'resize'], [document, 'fullscreenchange'], [document, 'visibilitychange'],
    [element, 'pointerdown'], [element, 'click'], [element, 'focusin']]
  for (const [target, type] of events) target.addEventListener(type, measure)
  const slideObserver = slide ? new MutationObserver(update) : null
  slideObserver?.observe(slide, { attributes: true, attributeFilter: ['class'] })
  return () => {
    io.disconnect()
    for (const [target, type] of events) target.removeEventListener(type, measure)
    slideObserver?.disconnect()
  }
}
