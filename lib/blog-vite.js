// lib/blog.js as Vite builds it (astro.config.js swaps it in): the blog's site data through `@/`, which Vite resolves
// and its dev server watches, and no Node APIs, so a figure in the browser can import lib/roles.js.
export { site } from '@/site.js'
export { roles } from '@/roles.js'
