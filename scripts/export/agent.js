// The agent download: the built post as one small HTML file for a language model to read. Math becomes
// MathML with its TeX source; each interactive figure becomes the text its describe.js writes, with
// traces computed by the figure's own numerics; the numerics source is appended. No scripts or media.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { toText } from 'hast-util-to-text'
import { visit, SKIP } from 'unist-util-visit'
import { esc } from '../../lib/describe.js'
import { roles } from '../../lib/roles.js'
import { dist, distAsset, hasClass, islandProps, root, siteLinks } from './common.js'

// A file a describe.js names in `sources`, from the blog's folder; `bloggie/…` is the engine's file wherever it is
// installed (node_modules/bloggie/, or the blog's bloggie/ folder).
const engine = fileURLToPath(new URL('../../', import.meta.url))
const sourcePath = (file) => existsSync(join(root, file)) ? join(root, file) : join(engine, file.replace(/^bloggie\//, ''))

// Component name -> its folder's describe.js, for every figure in src/figures/.
async function describers() {
  const found = new Map()
  const figures = join(root, 'src/figures')
  for (const folder of readdirSync(figures)) {
    const describe = join(figures, folder, 'describe.js')
    if (!existsSync(describe)) continue
    const module = await import(pathToFileURL(describe))
    for (const file of readdirSync(join(figures, folder))) if (file.endsWith('.svelte')) found.set(file.slice(0, -7), module)
  }
  return found
}

const raw = (value) => ({ type: 'raw', value })

// KaTeX output -> its MathML, which carries the TeX source as an annotation.
function toMathML(tree) {
  visit(tree, 'element', (node, index, parent) => {
    if (!hasClass(node, 'katex')) return
    let math
    visit(node, 'element', (m) => { if (m.tagName === 'math') { math = m; return SKIP } })
    parent.children[index] = math
    return SKIP
  })
}

// Text a figure marks with data-agent-text (such as a derivation in its inspector) goes into its description.
function keptText(island) {
  const kept = []
  visit(island, 'element', (node) => {
    if (node.properties?.dataAgentText === undefined) return
    toMathML(node)
    kept.push(`<div>${toHtml(node.children)}</div>`)
    return SKIP
  })
  return kept.join('')
}
const box = (html) => raw(`<div class="fig-text">${html}</div>`)

// `out` is the build's output directory; `site` the site's URL, for links back to it (see siteLinks).
export async function agentPage(html, { references, out = dist, site, base, pageUrl }) {
  const figures = await describers()
  const tree = fromHtml(html)
  siteLinks(tree, { site, base, pageUrl })
  const meta = (name) => {
    let content = ''
    visit(tree, 'element', (node) => { if (node.tagName === 'meta' && node.properties.name === name) content = node.properties.content })
    return content
  }
  let main
  visit(tree, 'element', (node) => { if (node.tagName === 'main') { main = node; return SKIP } })
  const sources = []
  const cited = []

  // A video without a text description gets a note, since the video itself is dropped below.
  visit(main, 'element', (node) => {
    if (node.tagName !== 'figure') return
    let video = false, described = false
    visit(node, 'element', (child) => { video ||= child.tagName === 'video'; described ||= hasClass(child, 'media-description') })
    if (video && !described) node.children.push(box('<p>A video is not included, and the post gives no text description of it.</p>'))
  })

  visit(main, 'element', (node, index, parent) => {
    const p = node.properties
    if (['script', 'style', 'video', 'img'].includes(node.tagName) || hasClass(node, 'info-button') || p.dataBibliography !== undefined) {
      parent.children.splice(index, 1)
      return [SKIP, index]
    }
    // An <Info term>: its words, as plain text.
    if (hasClass(node, 'info-term')) {
      node.tagName = 'span'
      node.properties = {}
      return
    }
    // An <Info> note: in parentheses after its label or term, and no longer a popover, which a browser would hide.
    if (hasClass(node, 'info-note')) {
      node.properties = {}
      node.children = [{ type: 'text', value: ' (' }, ...node.children, { type: 'text', value: ')' }]
      return
    }
    if (node.tagName === 'astro-island') {
      const name = JSON.parse(p.opts).name
      const figure = figures.get(name)
      if (!figure) {
        console.warn(`export: ${name} has no describe.js; the agent download uses its server-rendered text`)
        parent.children[index] = box(`<h4>Figure: ${esc(name)}</h4><p>(No description. Text of the figure's first frame:)</p><p>${esc(toText(node).replace(/\s+/g, ' ').trim())}</p>`)
        return SKIP
      }
      parent.children[index] = box(figure.describe(islandProps(p.props)) + keptText(node))
      for (const file of figure.sources) if (!sources.includes(file)) sources.push(file)
      return SKIP
    }
    if (hasClass(node, 'media-description')) {
      node.tagName = 'div'
      node.properties = { className: ['fig-text'] }
      for (const child of node.children) if (child.tagName === 'summary') Object.assign(child, { tagName: 'h4' })
      return
    }
    if (node.tagName === 'a' && p.dataCite) {
      const keys = String(p.dataCite).split(',') // <Cite key="a,b"> cites several sources
      for (const key of keys) if (!cited.includes(key)) cited.push(key)
      node.properties = { href: `#ref-${keys[0]}` }
      return
    }
    const asset = node.tagName === 'a' && distAsset(p.href, out)
    if (asset) {
      const text = asset.endsWith('.json') ? JSON.stringify(JSON.parse(readFileSync(asset, 'utf8'))) : '(file not included)'
      parent.children[index] = raw(`${esc(toText(node))}: <code>${esc(text)}</code>`)
      return SKIP
    }
  })
  toMathML(main)
  let title = '', byline = ''
  visit(main, 'element', (node) => {
    if (node.tagName === 'h1' && !title) title = toText(node).trim()
    if (hasClass(node, 'byline') && !byline) byline = toText(node).replace(/\s+/g, ' ').trim()
  })
  const summary = meta('agent-summary')
  const referenceList = cited.map((key) => {
    const r = references[key]
    if (!r) throw new Error(`export: reference ${key} is not in src/references.json`)
    return `<li id="ref-${key}">${esc(r.authors?.join(', ') ?? '')} (${r.year}). ${esc(r.title)}. ${esc(r.venue ?? '')}. <span class="url">${esc(r.url)}</span></li>`
  })
  const code = sources.map((file) => `<section><h3>${esc(file)}</h3><pre><code>${esc(readFileSync(sourcePath(file), 'utf8'))}</code></pre></section>`)
  const body = toHtml(main.children, { allowDangerousHtml: true })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Text export of the post for language models: math as MathML with TeX, figures as descriptions and traces, and the figures' source code.">
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1f; --muted: #5d5d66; --line: #d9d6cf; --panel: #f1efe9; --link: #1f5fa8; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16171a; --fg: #e8e6e1; --muted: #a3a1a9; --line: #34353b; --panel: #1f2024; --link: #8ab8f0; } }
:root[data-theme="dark"] { --bg: #16171a; --fg: #e8e6e1; --muted: #a3a1a9; --line: #34353b; --panel: #1f2024; --link: #8ab8f0; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 Charter, Georgia, serif; }
.page { max-width: 46rem; margin: 0 auto; padding: 2rem 16px 4rem; }
a { color: var(--link); }
h1, h2, h3, h4 { font-family: system-ui, sans-serif; line-height: 1.25; }
h2 { margin-top: 2.5rem; border-top: 1px solid var(--line); padding-top: 1.5rem; }
.eyebrow, .byline, .figure-source, figcaption { font-family: system-ui, sans-serif; color: var(--muted); font-size: .9rem; }
blockquote { margin: 1rem 0; padding: .25rem 1rem; border-left: 3px solid var(--line); color: var(--muted); }
math[display="block"] { margin: 1rem 0; overflow-x: auto; overflow-y: hidden; }
.fig-text, .note { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: .75rem 1rem; margin: 1rem 0; font-size: .95rem; }
.fig-text h4 { margin: .25rem 0 .5rem; }
figure { margin: 1rem 0; }
table { border-collapse: collapse; font: 12px/1.4 ui-monospace, Menlo, monospace; display: block; overflow-x: auto; margin: .5rem 0; }
th, td { border: 1px solid var(--line); padding: 2px 6px; text-align: right; white-space: nowrap; }
pre { font: 12px/1.4 ui-monospace, Menlo, monospace; overflow-x: auto; background: var(--panel); padding: .5rem; border-radius: 4px; }
code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; }
.url { word-break: break-all; font-family: ui-monospace, Menlo, monospace; font-size: .85em; }
</style>
</head>
<body>
<div class="page">
<div class="note">
<p><b>About this file.</b> A text export of the post “${esc(title)}” (${esc(byline)}), made so that a language model can study it without the website. Each interactive figure or video is replaced by a gray box that describes it; figure boxes list traces computed by the figure's own JavaScript with the post's parameters. Equations are MathML, and each carries its TeX source as an annotation. In the TeX, ${roles.map((r) => `\\${r.name}{…}`).join(', ')} mark a symbol's role, which is its color on the page (${roles.map((r) => `${r.label}: ${r.meaning}`).join('; ')}), and \\note{…} is a label that points at a term. Appendix A lists the cited works${code.length ? '; Appendix B holds the source of the figures\' numerics, which defines every update rule exactly' : ''}.</p>
${summary ? `<p><b>The question the post asks.</b> ${esc(summary)}</p>` : ''}
</div>
${body}
${referenceList.length ? `<h2 id="appendix-references">Appendix A. References</h2>\n<ol>${referenceList.join('\n')}</ol>` : ''}
${code.length ? `<h2 id="appendix-code">Appendix B. Source code of the figure numerics</h2>\n${code.join('\n')}` : ''}
</div>
</body>
</html>
`
}
