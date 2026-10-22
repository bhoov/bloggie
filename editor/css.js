// CSS text as the slide editor reads and writes it, for the page (client.js), the dev server
// (source.js) and the build (bloggie/lib/slide-headings.js).
//
//   declarations   "font-size: 44px; translate: 0 -20px"             a Box's style
//   rules          "li:nth-of-type(2) > span.mark { font-size: 60px }"  a Box's inner: CSS for elements
//                                                                    inside the block, such as the
//                                                                    parts of a figure

// "a: b; c: d" as [[a, b], [c, d]]; a semicolon inside parentheses or quotes does not split.
export function parseStyle(style = '') {
  const out = []
  let depth = 0
  let quote = null
  let part = ''
  for (const ch of `${style};`) {
    if (quote) { if (ch === quote) quote = null }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ';' && depth <= 0) {
      const colon = part.indexOf(':')
      if (colon > 0) out.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()])
      part = ''
      continue
    }
    part += ch
  }
  return out
}

export const formatStyle = (declarations) => declarations.map(([p, v]) => `${p}: ${v}`).join('; ')

// "sel { a: b } sel2 { c: d }" as [[sel, [[a, b]]], [sel2, [[c, d]]]].
export function parseRules(css = '') {
  const out = []
  for (const part of css.split('}')) {
    const open = part.indexOf('{')
    if (open < 0) continue
    const selector = part.slice(0, open).trim()
    if (selector) out.push([selector, parseStyle(part.slice(open + 1))])
  }
  return out
}

export const formatRules = (rules) => rules.filter(([, d]) => d.length).map(([s, d]) => `${s} { ${formatStyle(d)} }`).join(' ')

// The rules of a Box, each scoped to the element that holds them: "#<id> > <selector> { … }". A
// selector starts at a child of that element.
export const scopeRules = (rules, scope) => rules.filter(([, d]) => d.length).map(([s, d]) => `${scope} > ${s} { ${formatStyle(d)} }`).join('\n')
