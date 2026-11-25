// The PDF downloads of a built page: the post ("Blog as PDF") and its deck ("Slides as PDF", one slide per page), for a
// reader or a presentation machine that cannot run the page. A headless Chromium (e2e/browser.js: Chrome, Chromium, or
// the one $CHROME names) opens the built page in print media and prints it. An animation shows as its still
// (components/Still.astro); lib/print.js does what else a page needs first.
//
// The browser loads only this build's own files, from a server on 127.0.0.1: every <iframe> is served without its
// address, so no other site is opened.
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { launch } from '../../e2e/browser.js'
import { pdfPages } from '../../lib/pdf-pages.js'
import { preparePrint } from '../../lib/print.js'
import { siteUrl } from '../../lib/site-url.js'
import { dist } from './common.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}
// The size of the browser window a page loads in: a figure that measures itself when it starts must find the width it
// prints at. A deck's page is its 1600×900 stage (styles/slides.css). A post prints on Letter paper with the margins of
// styles/site.css (8.5 in less 2 × 16 mm, at 96 px to the inch).
const WINDOW = { post: { width: 695, height: 4000 }, slides: { width: 1600, height: 900 } }

// `out` is the build's output directory; `base` the base path it was built with; `site` the deployed site's URL, for
// links. Throws when no browser is found. Returns { print, close }.
export async function openPrinter({ out = dist, base = process.env.BASE_PATH || '/', site = siteUrl } = {}) {
  const browser = await launch()
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path.startsWith(base)) path = path.slice(base.length - 1)
    let file = join(out, path)
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!file.startsWith(out) || !existsSync(file)) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    if (extname(file) !== '.html') return res.end(readFileSync(file))
    res.end(readFileSync(file, 'utf8').replace(/<iframe\b[^>]*>/g, (tag) => tag.replace(/\s(?:data-)?src=/g, ' data-print-src=')))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  return {
    // `path` is the page's path under posts/ (lib/pages.js); `kind` is 'post' or 'slides'.
    // Returns { pdf, pages, missing }: the file, its page count, and the animations it cannot show (lib/print.js).
    async print(path, kind = 'post') {
      const page = await browser.newPage(WINDOW[kind])
      try {
        await page.cdp('Emulation.setEmulatedMedia', { media: 'print' })
        await page.goto(`${origin}${base}posts/${path}/${kind === 'slides' ? 'slides/' : ''}`)
        const { slides, missing } = await page.evaluate(`(${preparePrint})(${JSON.stringify({ site, base })})`)
        const { data } = await page.cdp('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
        const pdf = Buffer.from(data, 'base64')
        const pages = pdfPages(pdf)
        if (kind === 'slides' && pages !== slides) throw new Error(`export: the deck of ${path} has ${slides} slides, but its PDF has ${pages} pages; a slide overflows its page in print`)
        return { pdf, pages, missing }
      } finally {
        await page.close()
      }
    },
    async close() {
      server.close()
      await browser.close()
    },
  }
}
