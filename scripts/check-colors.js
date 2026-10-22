// Run by `npm run build`: math spells each symbol with its role (bloggie/lib/roles.js) in a post and its deck.
// A symbol is the TeX inside a role macro, such as \boldsymbol{v}_i in \state{\boldsymbol{v}_i}. The check reads
// each post's index.mdx and slides.mdx and fails where math spells a symbol without its role: $\boldsymbol{v}_i$
// in prose, where an equation has \state{\boldsymbol{v}_i}. \plain{…} marks a deliberate exception.
// A symbol keeps the role it was last given in its file (before that, the first it is given there, or the one
// role the other file gives it), so a letter that means something new in a later section is colored anew there;
// the check lists such symbols. A decorated or indexed spelling (\hat{v}, v^\star, v_0) is a symbol of its own.
// `node bloggie/scripts/check-colors.js --fix` wraps each spelling without its role in the role's macro, and says where.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { roles } from '../lib/roles.js'

const root = process.cwd() // the blog (lib/blog.js)
const postsDir = join(root, 'src/pages/posts')
const fix = process.argv.includes('--fix')

const MACRO = new RegExp(`\\\\(${roles.map((r) => r.name).join('|')}|plain)(?![A-Za-z])\\s*\\{`, 'g')
const TEXT_ARG = /\\(text|textbf|textit|textrm|mathrm|operatorname|label|tag|note|htmlClass)\s*\{/g
const DECORATION = /\\(hat|tilde|bar|widehat|widetilde|overline|dot|ddot|vec)\s*\{?\s*$/
const STARRED = /^\s*\^\s*\{?\s*(\\star|\*)/
const letter = (c) => c !== undefined && /[A-Za-z]/.test(c)

// The index of the } that closes the group opened at s[open] === '{'.
function closing(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return s.length - 1
}

// Spaces over [from, to), keeping newlines, so offsets and line numbers stay put.
const blank = (s, from, to) => s.slice(0, from) + s.slice(from, to).replace(/[^\n]/g, ' ') + s.slice(to)

// The math of an MDX file: [start, end) of each $…$ and $$…$$, outside front matter, code and comments.
function mathRegions(text) {
  let s = text.replace(/^---\n[\s\S]*?\n---\n/, (m) => m.replace(/[^\n]/g, ' '))
  for (const re of [/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, /\{\/\*[\s\S]*?\*\/\}/g, /<!--[\s\S]*?-->/g, /(`+)[^`\n][\s\S]*?\1/g]) {
    s = s.replace(re, (m) => m.replace(/[^\n]/g, ' '))
  }
  const regions = []
  for (const m of s.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    regions.push([m.index + 2, m.index + m[0].length - 2])
    s = blank(s, m.index, m.index + m[0].length)
  }
  for (const m of s.matchAll(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g)) regions.push([m.index + 1, m.index + m[0].length - 1])
  return regions.sort((a, b) => a[0] - b[0])
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length

let failures = 0
for (const slug of readdirSync(postsDir).sort()) {
  const files = ['index.mdx', 'slides.mdx'].map((name) => join(postsDir, slug, name)).filter(existsSync)
  const docs = files.map((path) => ({ path, rel: relative(root, path), text: readFileSync(path, 'utf8'), given: [] }))
  // Each file's colored symbols in order: { offset, tex, role }.
  for (const doc of docs) {
    doc.regions = mathRegions(doc.text)
    for (const [start, end] of doc.regions) {
      for (const m of doc.text.slice(start, end).matchAll(MACRO)) {
        const open = start + m.index + m[0].length - 1
        const tex = doc.text.slice(open + 1, closing(doc.text, open)).trim()
        if (m[1] === 'plain' || !tex || /\\(note|text)\b/.test(tex) || tex.match(MACRO)) continue
        doc.given.push({ offset: open, tex, role: m[1] })
      }
    }
  }
  const colored = [...new Set(docs.flatMap((doc) => doc.given.map((g) => g.tex)))].sort((a, b) => b.length - a.length)
  const rolesIn = (doc, tex) => [...new Set(doc.given.filter((g) => g.tex === tex).map((g) => g.role))]
  // The role in force at `offset`: the last one given before it in this file, else the first after it, else the
  // other file's, if that file gives the symbol one role only.
  function roleAt(doc, tex, offset) {
    const own = doc.given.filter((g) => g.tex === tex)
    const before = own.filter((g) => g.offset < offset).at(-1) ?? own[0]
    if (before) return before.role
    const other = docs.filter((d) => d !== doc).flatMap((d) => rolesIn(d, tex))
    return new Set(other).size === 1 ? other[0] : null
  }
  for (const doc of docs) {
    for (const tex of colored) {
      if (rolesIn(doc, tex).length < 2) continue
      const changes = doc.given.filter((g) => g.tex === tex).filter((g, i, all) => i === 0 || all[i - 1].role !== g.role)
      console.log(`check-colors: ${doc.rel}: ${tex} is ${changes.map((g) => `\\${g.role} from line ${lineOf(doc.text, g.offset)}`).join(', then ')}`)
    }
  }

  for (const doc of docs) {
    const found = [] // { offset, tex, role, brace }
    for (const [start, end] of doc.regions) {
      // The math with every role macro and \plain{…} blanked, and the ranges of its text-mode arguments.
      let free = doc.text.slice(start, end)
      const math = free
      for (const m of math.matchAll(MACRO)) free = blank(free, m.index, closing(math, m.index + m[0].length - 1) + 1)
      const textArgs = [...math.matchAll(TEXT_ARG)].map((m) => [m.index, closing(math, m.index + m[0].length - 1)])
      for (const tex of colored) {
        for (let i = free.indexOf(tex); i !== -1; i = free.indexOf(tex, i + 1)) {
          const before = free[i - 1], after = free.slice(i + tex.length).trimStart()[0]
          if (letter(tex[0]) && (letter(before) || before === '\\')) continue
          if (tex[0] === '\\' && before === '\\') continue
          if (letter(tex.at(-1)) && letter(free[i + tex.length])) continue
          if (after === '_' || DECORATION.test(free.slice(Math.max(0, i - 14), i)) || STARRED.test(free.slice(i + tex.length, i + tex.length + 20))) continue
          if (textArgs.some(([a, b]) => i > a && i < b)) continue
          found.push({ offset: start + i, tex, role: roleAt(doc, tex, start + i), brace: before === '_' || before === '^' })
          free = blank(free, i, i + tex.length)
        }
      }
    }
    if (!found.length) continue
    let text = doc.text
    for (const { offset, tex, role, brace } of found.sort((a, b) => b.offset - a.offset)) {
      const at = `${doc.rel}:${lineOf(doc.text, offset)}`
      if (!role) {
        console.error(`check-colors: ${at}: ${tex} has several roles in the other file and none here; write it with its role`)
        failures++
        continue
      }
      const wrapped = brace ? `{\\${role}{${tex}}}` : `\\${role}{${tex}}`
      if (fix) {
        text = `${text.slice(0, offset)}${wrapped}${text.slice(offset + tex.length)}`
        console.log(`check-colors: ${at}: ${tex} -> ${wrapped}`)
      } else {
        console.error(`check-colors: ${at}: ${tex} without its role; write ${wrapped}, or \\plain{${tex}} if that is deliberate`)
        failures++
      }
    }
    if (fix) writeFileSync(doc.path, text)
  }
}
if (failures) {
  console.error(`check-colors: ${failures} problem(s); \`node bloggie/scripts/check-colors.js --fix\` wraps each symbol written without its role`)
  process.exit(1)
}
if (!fix) console.log('check-colors: every symbol is written with its role')
