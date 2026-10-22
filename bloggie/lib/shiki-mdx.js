// The `mdx` language for code blocks (astro.config.mjs, markdown.shikiConfig). Shiki's bundled MDX
// grammar leaves an `import` line and a component tag as plain paragraph text, and the TeX between
// `$$` as raw text, so a post's own syntax renders in one color. This grammar highlights each part as
// what MDX reads it as: `import`/`export` lines as TSX; a component tag (a Svelte figure is a JSX tag
// in MDX) with its attributes, strings and `{…}` expressions; `$$ … $$` and `$ … $` as LaTeX; an
// empty-text link `[](#id)` (an equation number); and everything else as Markdown.

// Loaded beside it (astro.config.mjs passes their grammars, since it includes them by scope name).
export const mdxLanguages = ['tsx', 'latex', 'markdown']

const math = (begin, end) => ({
  begin,
  end,
  beginCaptures: { 1: { name: 'string.other.begin.math.mdx' } },
  endCaptures: { 1: { name: 'string.other.end.math.mdx' } },
  contentName: 'meta.embedded.math.latex',
  patterns: [{ include: 'text.tex.latex' }],
})

export const mdxGrammar = {
  name: 'mdx',
  scopeName: 'source.mdx',
  displayName: 'MDX',
  embeddedLangs: mdxLanguages,
  patterns: [{ include: '#esm' }, { include: '#math-block' }, { include: '#tag' }, { include: 'text.html.markdown' }],
  // Inside Markdown text (an included grammar does not push its own scope, so select on this one).
  injections: {
    'L:source.mdx -meta.embedded -meta.tag.mdx -string -markup.inline.raw -comment': {
      patterns: [{ include: '#math-inline' }, { include: '#tag' }, { include: '#number-link' }],
    },
  },
  repository: {
    // An import may wrap: it ends at a line that ends with a quote or a semicolon, or at a blank line.
    esm: { begin: '^(?=(?:import|export)\\b)', end: '(?<=[\'";])\\s*$|^(?=\\s*$)', patterns: [{ include: 'source.tsx' }] },
    'math-block': math('^\\s*(\\$\\$)', '(\\$\\$)'),
    'math-inline': math('(?<![\\\\$\\w])(\\$)(?=[^\\s$])', '(\\$)'),
    // <Name attr="…" attr={…} /> and </Name>; ends at its own `>`, so Markdown inside an element stays Markdown.
    tag: {
      begin: '(</?)([A-Z][\\w.]*|[a-z][\\w-]*(?=[\\s/>]))',
      end: '(/?>)',
      beginCaptures: { 1: { name: 'punctuation.definition.tag.begin.mdx' }, 2: { name: 'support.class.component.mdx' } },
      endCaptures: { 1: { name: 'punctuation.definition.tag.end.mdx' } },
      name: 'meta.tag.mdx',
      patterns: [
        { match: '[A-Za-z_][\\w:-]*', name: 'entity.other.attribute-name.mdx' },
        { match: '=', name: 'keyword.operator.assignment.mdx' },
        { match: '"[^"]*"|\'[^\']*\'', name: 'string.quoted.mdx' },
        { begin: '\\{', end: '\\}', beginCaptures: { 0: { name: 'punctuation.section.embedded.begin.mdx' } }, endCaptures: { 0: { name: 'punctuation.section.embedded.end.mdx' } }, contentName: 'meta.embedded.expression.tsx', patterns: [{ include: 'source.tsx' }] },
      ],
    },
    'number-link': {
      match: '(\\[\\])(\\()(#[^)\\s]+)(\\))',
      captures: { 1: { name: 'string.other.begin.link.mdx' }, 2: { name: 'string.other.begin.mdx' }, 3: { name: 'markup.underline.link.mdx' }, 4: { name: 'string.other.end.mdx' } },
    },
  },
}
