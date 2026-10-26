// Both downloads of one built page. `out` is the build's output directory (dist/ after `npm run build`,
// a scratch directory under the dev server); `path` is the page's path under posts/ in it (lib/pages.js): a post's
// slug, or a subpage's '<slug>/<name>'. `slug`, the older name for it, still works.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './common.js'
import { interactivePage } from './page.js'
import { agentPage } from './agent.js'

export async function exportPost({ out, path, slug, site, base }) {
  path ??= slug
  const html = readFileSync(join(out, 'posts', path, 'index.html'), 'utf8')
  const references = JSON.parse(readFileSync(join(root, 'src/references.json'), 'utf8'))
  // The page's own URL path, against which its relative links resolve (siteLinks).
  const pageUrl = `posts/${path}/`
  // The deck, when the page has one, travels inside the interactive page.
  const deckFile = join(out, 'posts', path, 'slides', 'index.html')
  const deck = existsSync(deckFile) ? await interactivePage(readFileSync(deckFile, 'utf8'), { out, site, base, pageUrl: `${pageUrl}slides/`, inFrame: true }) : null
  return {
    page: await interactivePage(html, { out, site, base, pageUrl, deck }),
    agent: await agentPage(html, { references, out, site, base, pageUrl }),
  }
}

export { downloadNames } from '../../lib/pages.js'
