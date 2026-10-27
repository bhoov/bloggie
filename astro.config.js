// Bloggie's build configuration. A blog's astro.config.mjs is one line, `export { default } from 'bloggie/astro.config.js'`,
// and this file, in the engine (node_modules/bloggie/, or the blog's bloggie/ folder), holds the rest. Posts and slides are MDX pages under the
// blog's src/pages; figures are Svelte components under its src/figures. Math is typeset at build time by KaTeX;
// lib/equations.js numbers labelled equations and resolves [](#eq-id) references.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import svelte from '@astrojs/svelte'
import { unified } from '@astrojs/markdown-remark'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkEquations from './lib/equations.js'
import { root } from './lib/blog.js'
import { katexMacros, remarkRoles } from './lib/roles.js'
import remarkPostTables from './lib/post-tables.js'
import remarkSlideHeadings, { rehypeSlideBoxes } from './lib/slide-headings.js'
import rehypeMathPunctuation from './lib/math-punctuation.js'
import postDownloads from './scripts/export/dev.js'
import slideEditor from './editor/integration.js'
import liveUpdate from './live/integration.js'
import jumpToSource from './jump/integration.js'
import { rehypeSourcePositions, withMathPositions } from './jump/annotate.js'
import tsx from 'shiki/langs/tsx.mjs'
import latex from 'shiki/langs/latex.mjs'
import markdownLang from 'shiki/langs/markdown.mjs'
import { mdxGrammar } from './lib/shiki-mdx.js'

// Dev only. Astro links each server-rendered Svelte component's CSS module, and the browser may ask for it before the
// client has compiled the component (a client:visible island that has not hydrated). vite-plugin-svelte then finds no
// compiled CSS, and Vite serves the raw .svelte file as CSS: the first rule is lost and the rest lose their scoping, so
// one figure's styles leak onto the whole page (a Load demo cover over the title, figures out of shape). Compile the
// component first, and serve its CSS.
function svelteCssInDev() {
  let server
  return {
    name: 'svelte-css-in-dev',
    apply: 'serve',
    configureServer(s) { server = s },
    async load(id) {
      if (!/[?&]svelte&type=style&lang\.css$/.test(id)) return
      const filename = id.replace(/\?.*$/, '')
      if (this.getModuleInfo(filename)?.meta?.svelte?.css) return // compiled here: vite-plugin-svelte serves it
      // The server's compile of the component made the page's class names, so its CSS is the one that matches them.
      // transformRequest compiles it again if the file changed since, and otherwise returns the compile it has.
      const ssr = server?.environments?.ssr
      if (!ssr) return
      await ssr.transformRequest(`/${relative(server.config.root, filename)}`).catch(() => {})
      const css = ssr.moduleGraph.getModuleById(filename)?.meta?.svelte?.css
      if (!css) return
      this.addWatchFile(filename)
      return { code: css.code, map: css.map, moduleType: 'css' }
    },
  }
}

// Under Vite (pages, figures, the browser), lib/blog.js is lib/blog-vite.js: the same site data, through `@/`.
function blogInVite() {
  const node = fileURLToPath(new URL('./lib/blog.js', import.meta.url))
  const vite = fileURLToPath(new URL('./lib/blog-vite.js', import.meta.url))
  return {
    name: 'bloggie-blog',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('blog.js')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved?.id === node ? vite : null
    },
  }
}

// The blog is the folder Astro runs in (lib/blog.js); `@/` is its src/.
const blog = pathToFileURL(root + '/')
const engine = new URL('./', import.meta.url)

// The home page (pages/index.astro): every post, newest first. A blog with its own src/pages/index.astro uses that.
function homePage() {
  return {
    name: 'bloggie-home-page',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        if (existsSync(new URL('src/pages/index.astro', blog))) return
        injectRoute({ pattern: '/', entrypoint: fileURLToPath(new URL('pages/index.astro', engine)) })
      },
    },
  }
}

export default defineConfig({
  root: fileURLToPath(blog),
  // GitHub Pages serves a project site under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  // postDownloads: the download links under `npm run dev`; liveUpdate: a save of a post draws its change in the
  // open page, without a reload (live/); slideEditor: edit a deck with the mouse and keyboard under
  // `npm run dev`, written to its slides.mdx (editor/). liveUpdate goes before slideEditor (live/integration.js).
  // jumpToSource: under `npm run dev`, Cmd+Shift+click opens the source of what is clicked in VS Code (jump/).
  // hmr: false: a change to a figure's .svelte or .js reloads the page, so every figure starts over,
  // instead of a hot swap that keeps the figure's state and leaves its old animation loops running.
  // optimize: MDX compiles the static parts of a page to HTML strings; the page is the same, and the
  // dev server compiles a deck again after a slide editor edit in about half the time. A <style> or
  // <script> stays an element (a Box's inner rules are a <style>): in an HTML string, Astro drops its text.
  integrations: [mdx({ optimize: { ignoreElementNames: ['style', 'script'] } }), svelte({ compilerOptions: { hmr: false } }), postDownloads(), liveUpdate(), slideEditor(), jumpToSource(), homePage()],
  devToolbar: { enabled: false }, // no Astro toolbar over the page under `npm run dev`
  // `@/` is src/, so posts import `@/figures/attention-walk/AttentionWalk.svelte` instead of ../../../ paths; `@bloggie/` is
  // bloggie/, the engine (`@bloggie/components/Cite.astro`, a post's `layout: '@bloggie/layouts/Post.astro'`).
  vite: {
    plugins: [svelteCssInDev(), blogInVite()],
    resolve: { alias: { '@': fileURLToPath(new URL('src', blog)), '@bloggie': fileURLToPath(engine).replace(/\/$/, '') } },
    build: { assetsInlineLimit: 0 }, // keep imported files (e.g. a figure's JSON parameters) as real, linkable files
    // Pre-bundle the figures' dependencies at dev-server start. Found later, at a figure's first
    // import, they make Vite re-optimize and answer the open page with "504 Outdated Optimize Dep".
    // The engine as an npm package (node_modules/bloggie/) is source, not a dependency to pre-bundle or leave to Node:
    // Vite compiles its .astro and .svelte files, applies `@/` in them, and keeps one copy of each module.
    optimizeDeps: { include: ['d3', 'katex'], exclude: ['bloggie'] },
    ssr: { noExternal: ['bloggie'] },
    // The dev server watches the whole project: not the Python environment, or what a post's runs write.
    server: { watch: { ignored: ['**/.venv/**', '**/__pycache__/**', '**/_experiments/runs/**', '**/_experiments/logs/**'] } },
  },
  markdown: {
    // `mdx` code blocks: imports and component tags as TSX, math as LaTeX (lib/shiki-mdx.js).
    shikiConfig: { langs: [...tsx, ...latex, ...markdownLang, mdxGrammar] },
    processor: unified({
      remarkPlugins: [remarkMath, remarkPostTables, remarkEquations, remarkRoles, remarkSlideHeadings], // roles: the post's color key; slide-headings: # / ## shorthand in slides.mdx
      rehypePlugins: [[withMathPositions(rehypeKatex), {
        // \state{v} and the other role macros (lib/roles.js) color a symbol with \htmlClass; nothing else is trusted.
        macros: katexMacros,
        trust: (context) => context.command === '\\htmlClass',
        strict: (code) => (code === 'htmlExtension' ? 'ignore' : 'warn'),
      }], rehypeMathPunctuation, rehypeSlideBoxes, rehypeSourcePositions], // math-punctuation: no line break between inline math and its punctuation; slide-boxes: a <Box style> in slides.mdx styles the element it holds; source-positions: dev only, last (jump/annotate.js)
    }),
  },
})
