// The roles a math symbol plays, one color each, the same in every post and deck. Each blog lists its own roles, with
// their colors, in src/roles.js. Wrap a symbol in its role's macro wherever it appears, in an equation, its legend, the
// prose or a slide: $\given{X}$ for a role named `given`. Two more macros:
//
//   \note{text}                   a label that points at a term (\overbrace{…}^{\note{…}}), plain;
//                                 \given{\note{text}} gives it the role's color
//   \plain{x}                     x, deliberately without its role here (bloggie/scripts/check-colors.js skips it)
//
// bloggie/scripts/check-colors.js, run by `npm run build`, fails when the same TeX has two roles in one post and its
// deck, or appears without its role; `node bloggie/scripts/check-colors.js --fix` wraps each such appearance.
// remarkRoles lists the roles a page uses, and Post.astro shows a key of those roles under the byline.

import { roles } from './blog.js'

export { roles }

// The roles' colors as CSS, which Base.astro puts in every page's head: a --role-<name> token for the light and the
// dark theme (under the OS media query and data-theme, as site.css declares its tokens), and the rules that color a
// symbol and a \note inside it. `html` raises each rule above the slide styles' own `.slide …` rules.
const DARK = ':root:where(:not([data-theme="light"]))'
export const roleCss = [
  `:root { ${roles.map((r) => `--role-${r.name}: ${r.light};`).join(' ')} }`,
  `@media (prefers-color-scheme: dark) { ${DARK} { ${roles.map((r) => `--role-${r.name}: ${r.dark};`).join(' ')} } }`,
  `:root[data-theme="dark"] { ${roles.map((r) => `--role-${r.name}: ${r.dark};`).join(' ')} }`,
  ...roles.map(({ name }) => `html .role-${name}, html .slide .role-${name}, html .role-${name} .eq-note { color: var(--role-${name}); }`),
].join('\n')

export const katexMacros = {
  ...Object.fromEntries(roles.map(({ name }) => [`\\${name}`, `\\htmlClass{role-${name}}{#1}`])),
  '\\note': '\\htmlClass{eq-note}{\\text{#1}}',
  '\\plain': '#1',
}

const USE = new RegExp(`\\\\(${roles.map((r) => r.name).join('|')})(?![A-Za-z])`, 'g')

// remark plugin: front matter `roles`, the names of the roles the page's math uses, in the order above.
export function remarkRoles() {
  return (tree, file) => {
    const used = new Set()
    const visit = (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') for (const [, name] of node.value.matchAll(USE)) used.add(name)
      node.children?.forEach(visit)
    }
    visit(tree)
    const frontmatter = file.data.astro?.frontmatter
    if (frontmatter) frontmatter.roles = roles.map((r) => r.name).filter((name) => used.has(name))
  }
}
