// The slide editor's dev-server half (an Astro integration). Under `npm run dev` it
//   - marks each slide block with its id (setMarkBlocks, bloggie/lib/slide-headings.js), and
//   - answers the editor (client.js) at /__slide-editor: it reads and writes the deck's slides.mdx
//     with the edits in source.js, and keeps an undo history per file while the server runs.
// `npm run build` does neither, so a built page has no markers and no editor.
//
// The editor's writes do not reload the page, so the full reload Astro sends for such a write is
// dropped: for a change of CSS the page has drawn it already, and for any other change the page
// fetches the server's new render and swaps in the slides and blocks that changed (patch.js). A save
// from another editor reloads the page as usual.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setMarkBlocks } from '../lib/slide-headings.js'
import { EditError, applyEdit, outline, readBlock } from './source.js'

const ENDPOINT = '/__slide-editor'
// The version of the requests and answers between the page (client.js) and this server. The dev
// server loads this file when it starts, but the page's code is new on every load: after a change
// here, the page tells the author to restart `npm run dev` rather than work with an older server.
export const PROTOCOL = 4
const HISTORY = 200 // undo steps kept per file

const version = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
// A change of CSS as the list of edits the page shows: a batch is its edits.
const flatten = (edit) => (!edit ? null : edit.type === 'batch' ? edit.edits : [edit])

export default function slideEditor() {
  let root = ''
  const quiet = new Map() // file -> { content, until }: a write whose page reload is dropped
  let dropReloadsUntil = 0
  const histories = new Map() // file -> { undo: [...], redo: [...] }

  // The deck file a request names: an existing slides.mdx under src/pages.
  const deckFile = (path) => {
    const file = resolve(String(path ?? ''))
    if (!file.startsWith(resolve(root, 'src/pages') + sep) || !file.endsWith(`${sep}slides.mdx`)) throw new EditError(`${path} is not a deck under src/pages`)
    return file
  }

  // The editor's writes do not reload the page: it draws the change itself (client.js, patch.js).
  const write = (file, content) => {
    quiet.set(file, { content, until: Date.now() + 10000 })
    writeFileSync(file, content)
  }

  async function answer(body) {
    const file = deckFile(body.file)
    const source = readFileSync(file, 'utf8')
    const current = version(source)
    const history = histories.get(file) ?? { undo: [], redo: [] }
    histories.set(file, history)
    if (body.action === 'open') return { protocol: PROTOCOL, version: current, outline: outline(source), undo: history.undo.length, redo: history.redo.length }
    if (body.version !== current) return { status: 409, error: 'slides.mdx changed outside the editor; the page reloads to show it', reload: true, version: current }

    if (body.action === 'read') return { version: current, ...readBlock(source, body.id) }

    if (body.action === 'edit') {
      const result = applyEdit(source, body.edit)
      if (result.unchanged) return { version: current, rerender: false }
      // A change of CSS the page has already drawn; any other change the page draws again from the
      // server's render (rerender), without a reload.
      const rerender = !!(result.reload || result.rerender || !result.inverse)
      write(file, result.source)
      history.undo.push({ before: source, after: result.source, rerender, undo: flatten(result.inverse), redo: result.inverse ? flatten(body.edit) : null })
      if (history.undo.length > HISTORY) history.undo.shift()
      history.redo.length = 0
      return { version: version(result.source), rerender, outline: outline(result.source), id: result.id, slide: result.slide, undo: history.undo.length, redo: 0 }
    }

    if (body.action === 'undo' || body.action === 'redo') {
      const [from, to] = body.action === 'undo' ? [history.undo, history.redo] : [history.redo, history.undo]
      const step = from.at(-1)
      if (!step) return { version: current, rerender: false, nothing: true, undo: history.undo.length, redo: history.redo.length }
      // Each step is a pair of whole files; the file must be the one the step left.
      const expected = body.action === 'undo' ? step.after : step.before
      if (source !== expected) {
        history.undo.length = 0
        history.redo.length = 0
        return { status: 409, error: 'slides.mdx changed outside the editor, so the undo history is cleared', reload: true, version: current }
      }
      from.pop()
      to.push(step)
      const content = body.action === 'undo' ? step.before : step.after
      const apply = body.action === 'undo' ? step.undo : step.redo
      const rerender = step.rerender || !apply
      write(file, content)
      return { version: version(content), rerender, apply: rerender ? null : apply, outline: outline(content), undo: history.undo.length, redo: history.redo.length }
    }
    throw new EditError(`unknown action "${body.action}"`)
  }

  return {
    name: 'slide-editor',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig }) => {
        setMarkBlocks(command === 'dev')
        if (command !== 'dev') return
        root = fileURLToPath(config.root)
        // Drop the page reload for a write of the editor's that changed only CSS. A hot update of
        // any other file, or of the deck with other content, cancels the drop.
        updateConfig({
          vite: {
            plugins: [{
              name: 'slide-editor:quiet-writes',
              hotUpdate: {
                order: 'pre',
                async handler({ file, read }) {
                  const entry = quiet.get(resolve(file))
                  if (!entry || entry.until < Date.now()) { dropReloadsUntil = 0; return }
                  dropReloadsUntil = (await read()) === entry.content ? Date.now() + 1000 : 0
                },
              },
            }],
          },
        })
      },
      'astro:server:setup': ({ server, logger }) => {
        const send = server.ws.send.bind(server.ws)
        server.ws.send = (payload, ...rest) => {
          if (payload?.type === 'full-reload' && Date.now() < dropReloadsUntil) return
          return send(payload, ...rest)
        }
        server.middlewares.use(async (req, res, next) => {
          if (!(req.url ?? '').split('?')[0].endsWith(ENDPOINT)) return next()
          const reply = (status, data) => {
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(data))
          }
          // Only this page's own requests: a POST of JSON from the same origin.
          if (req.method !== 'POST' || !/^application\/json\b/.test(req.headers['content-type'] ?? '')) return reply(405, { error: 'POST JSON only' })
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'wrong origin' })
          let raw = ''
          for await (const chunk of req) {
            raw += chunk
            if (raw.length > 1e6) return reply(413, { error: 'too large' })
          }
          try {
            const { status = 200, ...data } = await answer(JSON.parse(raw))
            reply(status, data)
          } catch (error) {
            if (error instanceof EditError) return reply(422, { error: error.message })
            logger.error(String(error.stack ?? error))
            reply(500, { error: String(error.message ?? error) })
          }
        })
      },
    },
  }
}
