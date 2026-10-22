// The roles a math symbol plays, one color each, the same in every post and deck (site.css --role-*).
// Wrap a symbol in its role's macro wherever it appears, in an equation, its legend, the prose or a slide:
//
//   $\state{\boldsymbol{v}_i}$     the state: what descent changes (potentials, beliefs, predictions)
//   $\coupling{A^r_{ij}}$         the couplings: the weights between units (relations, memories)
//   $\given{\boldsymbol{B}}$      the given: what the input fixes (tokens, clamps, sources, biases)
//   $\truth{v^\star_{ia}}$        the truth: the true answer (solutions, targets)
//
//   \note{text}                   a label that points at a term (\overbrace{…}^{\note{…}}), plain;
//                                 \state{\note{text}} gives it the state's color
//   \plain{x}                     x, deliberately without its role here (bloggie/scripts/check-colors.js skips it)
//
// bloggie/scripts/check-colors.js, run by `npm run build`, fails when the same TeX has two roles in one post and its
// deck, or appears without its role; `node bloggie/scripts/check-colors.js --fix` wraps each such appearance.
// remarkRoles lists the roles a page uses, and Post.astro shows a key of those roles under the byline.

export const roles = [
  { name: 'state', label: 'state', meaning: 'what descent changes' },
  { name: 'coupling', label: 'couplings', meaning: 'the weights between units' },
  { name: 'given', label: 'given', meaning: 'what the input fixes' },
  { name: 'truth', label: 'truth', meaning: 'the true answer' },
]

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
