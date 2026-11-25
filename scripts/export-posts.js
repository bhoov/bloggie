// Run after `astro build` (part of `npm run build`): writes the downloads that the byline's download
// control links to, beside each built page under dist/posts/ that offers them (lib/pages.js: every post, and a
// subpage whose front matter sets `downloads: true`):
//   <name>.html        the interactive page, one file that opens from disk with working figures
//   <name>-agent.html  a text export for language models (bloggie/scripts/export/agent.js)
//   <name>.pdf         the page as a PDF, each animation as its still image (bloggie/scripts/export/pdf.js)
//   <name>-slides.pdf  the page's deck as a PDF, one slide per page, when the byline links to a deck
// <name> is the last part of the page's path: the post's slug, or the subpage's name.
// Each export inlines the page's scripts, styles, fonts and data into one file and bundles its figures, which takes
// time and space for every page; so a page without the control gets none.
// The PDFs need a browser to print them (Chrome or Chromium; $CHROME names another). Without one, or with
// BLOGGIE_PDF=0, the build goes on with no PDFs and takes their two links out of the built pages.
// Under `npm run dev`, bloggie/scripts/export/dev.js builds them on request instead.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist } from './export/common.js'
import { downloadNames, exportPost } from './export/index.js'

const kb = (data) => `${Math.round(Buffer.byteLength(data) / 1024)} KB`
// The byline's download control (layouts/Post.astro); a deck's page and a page that turns downloads off have none.
const OFFERS = /<[^>]*\sdata-download[\s>=]/
// Its links to the PDFs, each marked with the kind of PDF: data-pdf="post" or "slides".
// A PDF above this size gets a warning.
const BIG = 10 * 2 ** 20
const PDF_LINK = /<a\b[^>]*\sdata-pdf="(\w+)"[^>]*>[\s\S]*?<\/a>/g

// The built pages under dist/posts/, by their paths there ('<slug>', '<slug>/<name>', ...).
function pages(dir, path = '') {
  const found = path && existsSync(join(dir, 'index.html')) ? [path] : []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...pages(join(dir, entry.name), path ? `${path}/${entry.name}` : entry.name))
  }
  return found
}

// A blog with no visible post (e.g. a new blog with the example hidden) has no dist/posts.
const built = existsSync(join(dist, 'posts')) ? pages(join(dist, 'posts')) : []
const offering = built.filter((path) => OFFERS.test(readFileSync(join(dist, 'posts', path, 'index.html'), 'utf8')))
for (const path of offering) {
  const files = await exportPost({ out: dist, path })
  const names = downloadNames(path)
  for (const kind of ['page', 'agent']) writeFileSync(join(dist, 'posts', path, names[kind]), files[kind])
  console.log(`export-posts: ${path}/${names.page} (${kb(files.page)}), ${names.agent} (${kb(files.agent)})`)
}

// The PDFs, after the other downloads: one browser prints them all.
const wanted = offering.flatMap((path) => {
  const html = readFileSync(join(dist, 'posts', path, 'index.html'), 'utf8')
  return [...html.matchAll(PDF_LINK)].map(([, kind]) => ({ path, kind }))
})
if (wanted.length) {
  let printer = null
  let why = 'BLOGGIE_PDF=0'
  if (process.env.BLOGGIE_PDF !== '0') {
    try { printer = await (await import('./export/pdf.js')).openPrinter({ out: dist }) } catch (error) { why = error.message }
  }
  if (!printer) {
    for (const path of new Set(wanted.map((w) => w.path))) {
      const file = join(dist, 'posts', path, 'index.html')
      writeFileSync(file, readFileSync(file, 'utf8').replace(PDF_LINK, ''))
    }
    console.warn(`export-posts: no PDF downloads (${why}); their links are removed from the built pages`)
  } else {
    try {
      for (const { path, kind } of wanted) {
        const name = downloadNames(path)[kind === 'slides' ? 'slidesPdf' : 'pdf']
        const { pdf, pages: count, missing } = await printer.print(path, kind)
        writeFileSync(join(dist, 'posts', path, name), pdf)
        console.log(`export-posts: ${path}/${name} (${kb(pdf)}, ${count} pages)`)
        // A figure can print as thousands of images (an SVG pattern fill prints as one image for each shape it fills).
        if (pdf.length > BIG) console.warn(`export-posts:   over ${BIG / 2 ** 20} MB: a figure prints as many images; give it a still`)
        // What the PDF cannot show: give it a still (bloggie/components/Still.astro).
        for (const m of missing) console.warn(`export-posts:   ${m.slide ? `slide ${m.slide}${m.title ? ` "${m.title}"` : ''}: ` : ''}${m.what}`)
      }
    } finally {
      await printer.close()
    }
  }
}
