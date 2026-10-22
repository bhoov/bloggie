// The blog that uses this engine. Bloggie is an npm package in the blog's node_modules/bloggie/, or the blog's own
// bloggie/ folder (a git subtree), so the engine finds the blog by where it runs: npm runs a blog's scripts, and Astro
// its build and dev server, in the blog's folder. `site` and `roles` are the blog's src/site.js and src/roles.js. This
// file is for code that Node runs (the build scripts, the Markdown plugins); under Vite, astro.config.js puts
// lib/blog-vite.js in its place, which has no `root`.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const root = process.cwd()
const load = (file) => import(/* @vite-ignore */ pathToFileURL(join(root, file)).href)
export const { site } = await load('src/site.js')
export const { roles } = await load('src/roles.js')
