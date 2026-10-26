// Where a page sits among the posts, for the features that depend on it: the deck link, the downloads and the share
// link (layouts/Post.astro, scripts/export-posts.js, scripts/export/).
//
// A post is src/pages/posts/<slug>/index.mdx, at /posts/<slug>/; the home page lists it. Every other page under
// src/pages/posts/ is a subpage, which the home page does not list:
//   a file beside a post's index.mdx    posts/<slug>/<name>.mdx         -> /posts/<slug>/<name>/
//   a folder inside a post              posts/<slug>/<name>/index.mdx   -> /posts/<slug>/<name>/
// A page's path is its URL under posts/, without slashes at either end: '<slug>' for a post, '<slug>/<name>' (or
// deeper) for a subpage.

// The page's path from its URL path (`base` is the site's base path, import.meta.env.BASE_URL); null outside posts/.
export function pagePath(pathname, base = '/') {
  const prefix = `${base.replace(/\/?$/, '/')}posts/`
  if (!pathname.startsWith(prefix)) return null
  return pathname.slice(prefix.length).replace(/\/+$/, '') || null
}

export const isSubpage = (path) => path.includes('/')

// A page offers the two downloads unless its front matter says otherwise (`downloads: false` on a post,
// `downloads: true` on a subpage). Subpages default to none: each download costs build time (see
// scripts/export-posts.js), and a subpage is usually reached from its post.
export const offersDownloads = (frontmatter, path) => frontmatter.downloads ?? !isSubpage(path)

// The downloads' file names, beside the page: named after the last part of its path.
export function downloadNames(path) {
  const name = path.split('/').at(-1)
  return { page: `${name}.html`, agent: `${name}-agent.html` }
}
