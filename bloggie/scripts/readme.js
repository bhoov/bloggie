// A post as GitHub Markdown, for a README: `node bloggie/scripts/readme.js [slug]` prints it, and `readme(root, slug)`
// returns it. `npm run bloggie:push` puts the example post into the template's README this way, in place of the line
// `<!-- how-this-blog-works -->`, so the README shows the post as it is at each push.
//
// It knows the forms the example post uses, and fails on any other tag, so a new form is added here before it reaches
// a README: headings with ids (one level down, links to them follow GitHub's anchors), figure tags (a picture
// media/<fig-id>.png when the post has one, else a line that says where to play it), equation numbers and [](#…)
// references, role macros (as \color with the role's light color, which GitHub's math draws), citations (numbered
// links, and a References list at the end), <RoleKey />, figures with an image, and <Code> of a raw import.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const githubSlug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')

export async function readme(root, slug, { skip = [] } = {}) {
  const dir = join(root, 'src/pages/posts', slug)
  const path = (file) => relative(root, join(dir, file)).split('\\').join('/')
  const source = readFileSync(join(dir, 'index.mdx'), 'utf8')
  const references = JSON.parse(readFileSync(join(root, 'src/references.json'), 'utf8'))
  const { roles } = await import(pathToFileURL(join(root, 'src/roles.js')).href)

  const [, front, whole] = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  // `skip`: ids of sections to leave out, each up to the next <h2>.
  const body = skip.reduce((text, id) => text.replace(new RegExp(`<h2 id="${id}">[\\s\\S]*?(?=<h2 |$)`), ''), whole)
  const lede = front.match(/^lede: >-\n((?:  .*\n?)+)/m)?.[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
  const imports = Object.fromEntries([...body.matchAll(/^import (\w+) from '([^']+)'$/gm)].map(([, name, from]) => [name, from]))

  // Numbers and GitHub anchors for every id the post links to.
  const target = {}
  let figures = 0
  let equations = 0
  for (const m of body.matchAll(/<h[23] id="([^"]+)">([^<]+)<\/h[23]>|id="(fig-[^"]+)"|\\label\{(eq-[^}]+)\}/g)) {
    if (m[1]) target[m[1]] = { anchor: githubSlug(m[2]) }
    else if (m[3]) target[m[3]] = { label: `Fig. ${++figures}`, number: figures }
    else target[m[4]] = { label: `Eq. (${++equations})`, number: equations }
  }

  const color = (tex) => roles.reduce((t, r) => t.replaceAll(`\\${r.name}{`, `{\\color{${r.light}}`), tex)
  const math = (tex) => color(tex).replace(/\\label\{(eq-[^}]+)\}/g, (_, id) => `\\tag{${target[id].number}}`)
    .replace(/\\note\{/g, '\\text{').replace(/\\(mathclap|plain)\{/g, '{')

  const cited = []
  const cite = (keys, text) => {
    const numbers = keys.split(',').map((k) => k.trim()).map((key) => {
      if (!references[key]) throw new Error(`readme: unknown citation ${key}`)
      if (!cited.includes(key)) cited.push(key)
      return cited.indexOf(key) + 1
    })
    const link = `[[${numbers.join(', ')}]](${references[keys.split(',')[0].trim()].url})`
    return /^\[.*\]$/.test(text) ? link : `${text} ${link}`
  }

  const blocks = body.split(/^(```[\s\S]*?^```)$/m) // odd entries are fenced code, left as they are
  const out = blocks.map((block, i) => {
    if (i % 2) return block
    const spans = [] // inline code and the source of a <Code>, left as they are
    let text = block.replace(/`[^`\n]+`/g, (code) => `\u0000${spans.push(code) - 1}\u0000`)
      .replace(/^import .*\n/gm, '')
      .replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => `$$${math(tex)}$$`)
      .replace(/\$([^$\n]+)\$/g, (_, tex) => `$${math(tex)}$`)
      .replace(/<h2 id="[^"]+">([^<]+)<\/h2>/g, '### $1')
      .replace(/<h3 id="[^"]+">([^<]+)<\/h3>/g, '#### $1')
      .replace(/<div id="(fig-[^"]+)"><(\w+)[^>]*\/><\/div>/g, (_, id) => existsSync(join(dir, 'media', `${id}.png`)) ? `![${target[id].label}](${path(`media/${id}.png`)})\n\n*${target[id].label}* A still of the live figure; run \`npm run dev\` to play it.` : `> **${target[id].label}** A live figure: run \`npm run dev\` to play it.`)
      .replace(/<Cite key="([^"]+)">([^<]*)<\/Cite>/g, (_, keys, t) => cite(keys, t))
      .replace(/<RoleKey \/>/g, () => roles.map((r) => `- $${color(`\\${r.name}{${r.example}}`)}$ **${r.label}**: ${r.meaning}.`).join('\n'))
      .replace(/<figure id="([^"]+)"[^>]*>\s*<img src=\{(\w+)\.src\}[^>]*alt="([^"]*)"[^>]*\/>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/g,
        (_, id, image, alt, caption) => `![${alt}](${path(imports[image])})\n\n*${target[id]?.label ?? ''}* ${caption.trim()}`)
      .replace(/<Code code=\{(\w+)\} lang="(\w+)"[^>]*\/>/g, (_, name, lang) => `\u0000${spans.push(`\`\`\`\`${lang}\n${readFileSync(join(dir, imports[name].replace(/\?raw$/, '')), 'utf8').trimEnd()}\n\`\`\`\``) - 1}\u0000`)
      .replace(/^<\/?div[^>]*>\n/gm, '')
      .replace(/^<\/?figure[^>]*>\n|^<\/?figcaption>\n/gm, '')
      .replace(/\[\]\(#([\w-]+)\)/g, (_, id) => target[id]?.label ?? `#${id}`)
      .replace(/\[([^\]]+)\]\(#([\w-]+)\)/g, (_, words, id) => target[id]?.anchor ? `[${words}](#${target[id].anchor})` : words)
      .replace(/\]\(slides\/\)/g, `](${path('slides.mdx')})`)
    const left = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, '').match(/<(?!\/?(details|summary)\b)[A-Za-z][^>]*>|\{[a-zA-Z]\w*\}/)
    if (left) throw new Error(`readme: ${slug}: no Markdown form for ${left[0]}; add one to bloggie/scripts/readme.js`)
    return text.replace(/\u0000(\d+)\u0000/g, (_, n) => spans[n])
  }).join('').replace(/\n{3,}/g, '\n\n').trim()

  const list = cited.map((key, i) => {
    const r = references[key]
    return `${i + 1}. ${r.authors.length > 3 ? `${r.authors[0]} et al` : r.authors.join(', ')}. [${r.title}](${r.url}). ${r.venue}, ${r.year}.`
  })
  return [lede, out, list.length ? `#### References\n\n${list.join('\n')}` : ''].filter(Boolean).join('\n\n') + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(await readme(join(dirname(fileURLToPath(import.meta.url)), '../..'), process.argv[2] ?? 'how-this-blog-works'))
}
