// Both downloads of one built post. `out` is the build's output directory (dist/ after `npm run build`,
// a scratch directory under the dev server); `slug` names the post folder in it.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './common.js'
import { interactivePage } from './page.js'
import { agentPage } from './agent.js'

export async function exportPost({ out, slug, site, base }) {
  const html = readFileSync(join(out, 'posts', slug, 'index.html'), 'utf8')
  const references = JSON.parse(readFileSync(join(root, 'src/references.json'), 'utf8'))
  // The deck, when the post has one, travels inside the interactive page.
  const deckFile = join(out, 'posts', slug, 'slides', 'index.html')
  const deck = existsSync(deckFile) ? await interactivePage(readFileSync(deckFile, 'utf8'), { out, site, base, inFrame: true }) : null
  return {
    page: await interactivePage(html, { out, site, base, deck }),
    agent: await agentPage(html, { references, out, site, base }),
  }
}

export const downloadNames = (slug) => ({ page: `${slug}.html`, agent: `${slug}-agent.html` })
