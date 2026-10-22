// Citation previews, the numbered bibliography, and BibTeX export. The links themselves are rendered
// at build time by bloggie/components/Cite.astro, so they work without this script.
const element = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  node.append(...children)
  return node
}

const sourceURL = (value, base) => {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported citation URL: ${value}`)
  return url.href
}

export function resolveReferences(catalog, keys, base) {
  return [...new Set(keys)].map((key, i) => {
    const entry = Object.hasOwn(catalog, key) && catalog[key]
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || !entry) throw new Error(`Unknown citation key: ${key}`)
    if (!['paper', 'artifact'].includes(entry.type) || !entry.title || !entry.url ||
        !Array.isArray(entry.authors) || !entry.authors.length || !Number.isInteger(entry.year)) {
      throw new Error(`Incomplete reference: ${key}`)
    }
    return {
      ...entry, key, number: i + 1,
      url: sourceURL(entry.url, base),
      links: (entry.links ?? []).map(link => ({ ...link, url: sourceURL(link.url, base) })),
    }
  })
}

const bibEscape = value => String(value).replace(/[\\{}%&#_$~^]/g, character => ({
  '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
}[character] ?? `\\${character}`))

export function toBibTeX(references) {
  return references.map(ref => {
    const fields = {
      title: `{${bibEscape(ref.title)}}`,
      author: ref.authors.map(bibEscape).join(' and '),
      year: ref.year,
      ...(ref.venue ? { howpublished: bibEscape(ref.venue) } : {}),
      ...(ref.version ? { version: bibEscape(ref.version) } : {}),
      ...(ref.note ? { note: bibEscape(ref.note) } : {}),
      url: ref.url,
    }
    return `@misc{${ref.key},\n${Object.entries(fields).map(([key, value]) => `  ${key} = {${value}}`).join(',\n')}\n}`
  }).join('\n\n') + '\n'
}

// Sources besides the title's own link, each a small symbol after the title: the entry's `links`, and its arXiv page
// when the venue names an arXiv id but the title links elsewhere (a DOI).
export function extraSources(ref) {
  const links = [...ref.links]
  const id = ref.venue?.match(/arXiv:(\d{4}\.\d{4,5})/)?.[1]
  if (id && !ref.url.includes(id) && !links.some(link => link.url.includes(id))) {
    links.push({ label: 'arXiv preprint', url: `https://arxiv.org/abs/${id}` })
  }
  return links
}

// A source's symbol: code, a paper, a notebook, or any other page.
const ICONS = {
  code: 'M6 4 2 8l4 4M10 4l4 4-4 4',
  paper: 'M4 1.5h5.5l3 3v10H4zM9.5 1.5v3h3M6 8.5h4.5M6 11h4.5',
  notebook: 'M3.5 1.5h9v13h-9zM6 1.5v13M8.5 5h2.5M8.5 7.5h2.5',
  page: 'M9 2.5h4.5V7M13.5 2.5l-6 6M12 9.5v4H2.5V4h4',
}
const sourceKind = ({ label, url }) =>
  /notebook|colab|\.ipynb/i.test(label + url) ? 'notebook'
    : /github\.com|gitlab|\bcode\b/i.test(label + url) ? 'code'
      : /arxiv\.org|\.pdf\b|preprint|paper/i.test(label + url) ? 'paper' : 'page'

function sourceLink(link) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[sourceKind(link)])
  svg.append(path)
  const host = new URL(link.url).host.replace(/^www\./, '')
  return element('a', { href: link.url, class: 'reference-source', title: `${link.label} (${host})`, 'aria-label': link.label }, svg)
}

// Up to six authors in full; a longer list gives the first three and "et al.", with every name on hover.
const MAX_AUTHORS = 6
function authors(ref) {
  const all = ref.authors.join(', ')
  if (ref.authors.length <= MAX_AUTHORS) return element('span', { class: 'reference-authors' }, all)
  return element('span', { class: 'reference-authors', title: all }, `${ref.authors.slice(0, 3).join(', ')}, et al.`)
}

// A version that is a commit hash shows its first seven characters, and the whole hash on hover.
const version = value => /^[0-9a-f]{12,}$/i.test(value)
  ? element('span', { title: value }, `Version ${value.slice(0, 7)}`)
  : `Version ${value}`

// One entry: the title (the link to the source) and its other sources' symbols, then one line of authors, venue and
// year, then the note if there is one. `lead` goes before the title (the popup's number) and `trail` after the
// details line (the list's links back to the text).
function referenceBody(ref, { lead, trail } = {}) {
  const head = element('span', { class: 'reference-head' })
  if (lead) head.append(lead)
  head.append(element('a', { href: ref.url, class: 'reference-title' }, ref.title))
  const extra = extraSources(ref)
  if (extra.length) head.append(element('span', { class: 'reference-sources' }, ...extra.map(sourceLink)))
  // The venue without an "(arXiv:…)" aside: the title or a symbol links there.
  const venue = ref.venue?.replace(/\s*\(arXiv:[^)]*\)/, '')
  const where = [venue, ref.format].filter(Boolean)
  if (!where.some(part => part.includes(String(ref.year)))) where.push(String(ref.year))
  if (ref.version) where.push(version(ref.version))
  const details = element('span', { class: 'reference-meta' }, authors(ref), ...where.flatMap(part => [' · ', part]))
  // No break before the links back: they stay on the line they end.
  if (trail) details.append('\u00a0', trail)
  const body = element('span', { class: 'reference-body' }, head, details)
  if (ref.note) body.append(element('span', { class: 'reference-note' }, ref.note))
  return body
}

// `catalog` is src/references.json, imported by the page's script.
export function initCitations({ catalog, root = document.querySelector('main'), bibliography = document.querySelector('[data-bibliography]') }) {
  if (!root || !bibliography || bibliography.dataset.ready) return
  const originals = [...root.querySelectorAll('a[data-cite]')]
  if (!originals.length) {
    bibliography.remove()
    return
  }
  const groups = originals.map(node => node.dataset.cite.split(',').map(key => key.trim()))
  const references = resolveReferences(catalog, groups.flat(), location.href)
  const byKey = new Map(references.map(ref => [ref.key, ref]))
  const occurrences = new Map(references.map(ref => [ref.key, []]))
  let active = null
  let hideTimer = null

  const close = () => {
    clearTimeout(hideTimer)
    if (!active) return
    active.preview.hidden = true
    active.button.setAttribute('aria-expanded', 'false')
    active = null
  }
  const position = () => {
    if (!active) return
    const rect = active.button.getBoundingClientRect()
    const card = active.preview.getBoundingClientRect()
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - card.width - 12))
    const top = rect.bottom + card.height + 8 < window.innerHeight
      ? rect.bottom + 8 : Math.max(12, rect.top - card.height - 8)
    Object.assign(active.preview.style, { left: `${left}px`, top: `${top}px` })
  }
  const show = state => {
    clearTimeout(hideTimer)
    if (active !== state) close()
    active = state
    state.preview.hidden = false
    state.button.setAttribute('aria-expanded', 'true')
    position()
  }

  originals.forEach((original, i) => {
    const refs = [...new Set(groups[i])].map(key => byKey.get(key))
    const id = `cite-${i + 1}`
    const button = element('button', {
      type: 'button', class: 'citation-marker', id,
      'aria-label': `Citation ${refs.map(ref => `${ref.number}: ${ref.title}`).join('; ')}`,
      'aria-expanded': 'false', 'aria-controls': `${id}-preview`,
    }, `[${refs.map(ref => ref.number).join(', ')}]`)
    const preview = element('span', { class: 'citation-preview', id: `${id}-preview`, role: 'group', 'aria-label': 'Citation details' })
    preview.hidden = true
    const dismiss = element('button', { type: 'button', class: 'citation-close', 'aria-label': 'Close citation' }, '×')
    preview.append(dismiss)
    for (const ref of refs) {
      occurrences.get(ref.key).push(id)
      const number = element('a', { class: 'reference-number', href: `#ref-${ref.key}`, title: `Reference ${ref.number} in the list at the end` }, `[${ref.number}]`)
      preview.append(referenceBody(ref, { lead: number }))
    }
    const wrapper = element('span', { class: 'citation' }, button, preview)
    const state = { button, preview, wrapper }
    wrapper.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(state) })
    wrapper.addEventListener('pointerleave', () => {
      hideTimer = setTimeout(() => { if (!wrapper.contains(document.activeElement)) close() }, 180)
    })
    wrapper.addEventListener('focusin', () => show(state))
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) close() })
    button.addEventListener('click', () => show(state))
    dismiss.addEventListener('click', () => { button.focus(); close() })
    preview.addEventListener('click', event => {
      const link = event.target.closest('a')
      if (!link) return
      if (link.hash.startsWith('#ref-') && link.origin === location.origin && link.pathname === location.pathname) {
        document.getElementById(link.hash.slice(1))?.focus({ preventScroll: true })
      }
      close()
    })
    // "[HRM]" is a placeholder that the number replaces; other words ("Brouard et al.") stay, with the number after them.
    const words = /^\[[^\]]*\]$/.test(original.textContent.trim()) ? [] : [...original.childNodes]
    original.replaceWith(...words, wrapper)
  })

  const list = element('ol', { class: 'reference-list' })
  for (const ref of references) {
    const backlinks = element('span', { class: 'reference-backlinks', 'aria-label': 'Return to text' })
    occurrences.get(ref.key).forEach((id, i) => backlinks.append(element('a', {
      href: `#${id}`, 'aria-label': `Return to citation ${ref.number}, occurrence ${i + 1}`,
    }, `↩${occurrences.get(ref.key).length > 1 ? i + 1 : ''}`)))
    list.append(element('li', { id: `ref-${ref.key}`, tabindex: '-1' }, referenceBody(ref, { trail: backlinks })))
  }
  const download = element('button', { type: 'button', class: 'reference-export' }, 'Download BibTeX')
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([toBibTeX(references)], { type: 'application/x-bibtex;charset=utf-8' }))
    const link = element('a', { href: url, download: 'references.bib' })
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  bibliography.replaceChildren(element('div', { class: 'reference-heading' },
    element('h2', { id: 'references-title' }, 'References'), download), list)
  bibliography.dataset.ready = 'true'

  document.addEventListener('pointerdown', event => { if (active && !active.wrapper.contains(event.target)) close() })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) {
      const button = active.button
      if (active.wrapper.contains(document.activeElement)) button.focus()
      close()
    }
  })
  window.addEventListener('resize', position)
  window.addEventListener('scroll', event => {
    if (active && !active.preview.contains(event.target)) close()
  }, true)
  // A direct bibliography link may arrive before the asynchronous catalog. (In a render that the dev server's live
  // update enhances before it swaps it in, bloggie/live/, the entry is not on the page, and nothing scrolls.)
  if (location.hash.startsWith('#ref-')) root.ownerDocument.getElementById(location.hash.slice(1))?.scrollIntoView()
}
