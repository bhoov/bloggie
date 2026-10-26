// Helpers shared by the two post downloads (bloggie/scripts/export-posts.js): finding built assets,
// reading an Astro island's props, and removing the parts of a page that only work on the site.
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { visit, SKIP } from 'unist-util-visit'
import { root } from '../../lib/blog.js'
import { siteUrl } from '../../lib/site-url.js'

export { root }
export const dist = join(root, 'dist')

// A built asset URL, with or without the deploy's base path, as a file in <out>/_astro/; null for any
// other URL. `out` is the build's output directory: dist/, or the dev server's scratch build.
export function distAsset(url, out = dist) {
  const at = typeof url === 'string' ? url.indexOf('_astro/') : -1
  if (at < 0 || /^[a-z]+:/i.test(url)) return null
  return join(out, url.slice(at).split(/[?#]/)[0])
}

const MIME = {
  '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ckpt': 'text/plain',
}

export function dataUri(file) {
  const mime = MIME[extname(file)]
  if (!mime) throw new Error(`export: no media type for ${file}`)
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

// Astro serializes island props as [type, value] pairs: 0 a value (plain objects hold pairs again),
// 1 an array of pairs, 3 a Date, 11 Infinity. The posts use no other types.
export function islandProps(serialized) {
  const value = ([type, v]) => {
    if (type === 0) return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)])) : v
    if (type === 1) return v.map(value)
    if (type === 3) return new Date(v)
    if (type === 11) return v
    throw new Error(`export: island prop type ${type} is not supported`)
  }
  return value([0, JSON.parse(serialized)])
}

export const hasClass = (node, name) => (node.properties?.className || []).includes(name)

// Links back to the site: each root-relative link (the blog index, the Slides link) becomes a link to
// the deployed site, src/site.js `url`, so it works from a downloaded file when the reader is online.
// `base` is the base path the page was built with (BASE_PATH, as in astro.config.mjs). `pageUrl`, the page's own
// URL path under the base ('posts/<path>/'), makes a relative link (`../other-post/`, `./subpage/`) one to the
// deployed site too; without it, relative links stay as they are. The download control is removed.
export function siteLinks(tree, { site = siteUrl, base = process.env.BASE_PATH || '/', pageUrl = null } = {}) {
  visit(tree, 'element', (node, index, parent) => {
    if (node.properties?.dataDownload !== undefined) {
      parent.children.splice(index, 1)
      return [SKIP, index]
    }
    const href = node.tagName === 'a' ? node.properties.href : null
    // Built assets stay relative: each download inlines them (distAsset).
    if (typeof href !== 'string' || href.startsWith('//') || distAsset(href)) return
    if (pageUrl && !href.startsWith('/') && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      node.properties.href = new URL(href, new URL(pageUrl, site)).href
      return
    }
    if (!href.startsWith(base)) return
    node.properties.href = new URL(href.slice(base.length), site).href
  })
  // The byline separators (" / ") left without anything after them.
  visit(tree, 'element', (node) => {
    if (!hasClass(node, 'byline')) return
    const kids = node.children
    while (kids.length) {
      const last = kids.at(-1)
      const blank = last.type === 'text' && !last.value.trim()
      const slash = last.type === 'element' && last.tagName === 'span' && last.properties.ariaHidden === 'true'
      if (!blank && !slash) break
      kids.pop()
    }
    return SKIP
  })
}
