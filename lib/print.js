// What a page needs before it is printed to a PDF, done in the page itself: scripts/export/pdf.js runs it for the PDF
// downloads, and the slides skill's check-slides.mjs runs it to show what the PDF will hold. The page is already in
// print media (the print rules of styles/site.css and styles/slides.css apply), and this function is sent to the
// browser as text, so it uses nothing outside itself.
//
// - Every figure starts, except one that a still replaces (components/Still.astro), which print does not show.
// - A <video> with a poster and no still gets its poster as its still.
// - A YouTube player or an embedded page with no still becomes a box with its title and link: a PDF cannot hold it,
//   and the build must not depend on another site.
// - Stills load (on screen they are lazy and never fetched).
// - With `site`, links to other pages of the blog go to the deployed site, not to the server that printed the page.
//
// Returns { slides, missing }: the number of slides (0 for a post), and each animation the PDF cannot show
// ({ slide, title, what }; slide is null in a post).
export async function preparePrint({ site = null, base = '/' } = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const hasStill = (el) => !!el.nextElementSibling?.matches('img.still')
  const slides = [...document.querySelectorAll('.deck > .slide')]
  const missing = []
  const report = (el, what) => {
    const slide = el.closest('.deck > .slide')
    missing.push({ slide: slide ? slides.indexOf(slide) + 1 : null, title: slide?.dataset.title ?? null, what })
  }

  // A client:visible figure starts once it is seen, so scroll to each one that still waits (Astro removes `ssr`).
  const waiting = () => [...document.querySelectorAll('astro-island[ssr]')].filter((el) => !hasStill(el))
  for (const el of waiting()) {
    (el.firstElementChild ?? el.parentElement).scrollIntoView({ block: 'center' })
    await sleep(100)
  }
  scrollTo(0, 0)
  for (const end = Date.now() + 30000; waiting().length; await sleep(100)) {
    if (Date.now() > end) throw new Error(`${waiting().length} figures did not start`)
  }

  for (const video of document.querySelectorAll('video')) {
    if (hasStill(video)) continue
    const poster = video.getAttribute('poster')
    if (!poster) { report(video, 'a video with no poster and no still'); continue }
    const img = Object.assign(document.createElement('img'), { className: 'still', src: poster, alt: video.getAttribute('aria-label') ?? '' })
    video.after(img)
  }

  for (const frame of document.querySelectorAll('iframe')) {
    const el = frame.closest('.embed-crop') ?? frame
    if (hasStill(el)) continue
    const src = frame.dataset.printSrc ?? frame.dataset.src ?? frame.getAttribute('src') ?? ''
    const youtube = frame.classList.contains('youtube')
    const href = youtube ? `https://www.youtube.com/watch?v=${new URL(src, location.href).pathname.split('/').pop()}` : src
    const box = Object.assign(document.createElement('div'), { className: 'print-placeholder' })
    const kind = Object.assign(document.createElement('span'), { textContent: youtube ? 'Video on YouTube' : 'Interactive page' })
    const title = Object.assign(document.createElement('strong'), { textContent: frame.title })
    const link = Object.assign(document.createElement('a'), { href, textContent: href })
    box.append(kind, title, link)
    el.replaceWith(box)
    report(box, `${youtube ? 'a YouTube video' : 'an embedded page'} with no still`)
  }

  await Promise.all([...document.querySelectorAll('img.still')].map((img) => {
    img.loading = 'eager'
    return img.decode().catch(() => report(img, `a still that does not load (${img.getAttribute('src')})`))
  }))

  if (site) {
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.getAttribute('href').startsWith('#')) continue
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin) continue
      const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.slice(1)
      a.href = new URL(path + url.search + url.hash, site).href
    }
  }

  await document.fonts.ready
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return { slides: slides.length, missing }
}
