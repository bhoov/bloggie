// Astro integration: under `npm run dev`, answer the download control's two links. The dev server has no
// built files, so a request runs `astro build` into a scratch directory and exports the post from there
// (a few seconds). `npm run build` writes the same files with bloggie/scripts/export-posts.js.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

let building = null // one scratch build at a time; concurrent requests share it

function scratchBuild(root, out) {
  building ??= new Promise((resolve, reject) => {
    // NODE_ENV: the dev server's own "development" would make this build keep dev-only code
    // (import.meta.env.DEV, such as the slide editor), which the export cannot inline.
    const child = spawn(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', out], { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`astro build failed:\n${errors}`))))
  }).finally(() => { building = null })
  return building
}

export default function postDownloads() {
  return {
    name: 'post-downloads',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const base = process.env.BASE_PATH || '/'
        const root = server.config.root
        const out = join(root, 'node_modules/.cache/post-downloads')
        const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}posts/([^/]+)/([^/]+)\\.html$`)
        server.middlewares.use(async (req, res, next) => {
          const match = decodeURIComponent((req.url || '').split('?')[0]).match(pattern)
          const [, slug, name] = match ?? []
          if (!match || (name !== slug && name !== `${slug}-agent`)) return next()
          try {
            logger.info(`building the ${name}.html download`)
            await scratchBuild(root, out)
            const { exportPost } = await import('./index.js')
            const files = await exportPost({ out, slug, base })
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`)
            res.end(name === slug ? files.page : files.agent)
          } catch (error) {
            logger.error(String(error.stack || error))
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(`The download could not be built:\n${error.message}`)
          }
        })
      },
    },
  }
}
