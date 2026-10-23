// Jump to source, the dev server's half (an Astro integration). Under `npm run dev`, a Cmd+Shift+click (Ctrl+Shift+click)
// on a post or a deck opens the file and line that wrote what was clicked, in VS Code (client.js). This
//   - turns on the positions that annotate.js writes into each page,
//   - answers the page at /__jump-to-source with a file, a line and a column, which it moves from the save the page
//     shows to the file as it is now, and
//   - on a remote machine, opens the file in a VS Code window that is connected to it (vscode.js). Otherwise the page
//     opens it with a vscode:// link: on the author's own computer, or through an SSH host the page asks for once.
// `npm run build` does none of this.
//
// JUMP_TO_SOURCE=local or JUMP_TO_SOURCE=remote in the dev server's environment says where the author's browser is, when
// the guess below is wrong; either one also keeps the dev server from opening files in a VS Code window itself, so the
// page always opens a link (the end-to-end checks use it, bloggie/e2e/jump.js).
import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { saved, setSourcePositions } from './annotate.js'
import { openInVSCode } from './vscode.js'

const ENDPOINT = '/__jump-to-source'
const CLIENT = fileURLToPath(new URL('./client.js', import.meta.url))
const ENGINE = realpathSync(fileURLToPath(new URL('../', import.meta.url)))

// Whether the dev server runs on another machine than the author's browser: one they reach over SSH.
const SETTING = process.env.JUMP_TO_SOURCE
const remote = () => (SETTING ? SETTING === 'remote' : !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SLURM_JOB_ID || existsSync(join(homedir(), '.vscode-server'))))

// The lines of `now` that hold each line of `then`, by their longest common run of lines; a line that changed goes to
// the line at the same place in what replaced it. Lines and the result count from 0.
function lineMap(then, now) {
  let head = 0
  while (head < then.length && head < now.length && then[head] === now[head]) head++
  let tail = 0
  while (tail < then.length - head && tail < now.length - head && then[then.length - 1 - tail] === now[now.length - 1 - tail]) tail++
  const a = then.slice(head, then.length - tail)
  const b = now.slice(head, now.length - tail)
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const map = new Array(then.length)
  for (let k = 0; k < head; k++) map[k] = k
  let i = 0
  let j = 0
  let gapA = 0 // where the current run of changed lines starts, in a and in b
  let gapB = 0
  const close = () => {
    for (let k = gapA; k < i; k++) map[head + k] = head + Math.min(gapB + (k - gapA), Math.max(gapB, j - 1))
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close()
      map[head + i] = head + j
      gapA = ++i
      gapB = ++j
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) j++
    else i++
  }
  close()
  for (let k = 0; k < tail; k++) map[then.length - tail + k] = now.length - tail + k
  return map
}

// The position in the file as it is now of `line` and `column` in the save `version`.
function moveToNow(file, version, line, column) {
  const then = saved.get(version)
  if (then == null) return { line, column }
  const now = readFileSync(file, 'utf8')
  if (now === then) return { line, column }
  const thenLines = then.split('\n')
  const nowLines = now.split('\n')
  const mapped = lineMap(thenLines, nowLines)[line - 1]
  if (mapped == null) return { line, column }
  const to = Math.min(mapped, nowLines.length - 1)
  return { line: to + 1, column: nowLines[to] === thenLines[line - 1] ? column : 1 }
}

// Where in `source` the words of `text` around `offset` are: the clicked word, with up to four words on each side,
// separated by anything that is not a letter or digit (markup, smart quotes, line breaks). The first match between
// `after` and `before` (positions in the file), else, for three words or more, the first anywhere; then the clicked
// word alone, between the two; then the first component tag (`<Name`) between the two; then `after`. Lines and
// columns count from 1. Each text of `skip` of three words or more comes before what was clicked: the search starts
// after the last words of each that it finds.
const WORD = /[\p{L}\p{N}_]+/gu
const GAP = '[^\\p{L}\\p{N}_]+'
function findWords(source, text, offset, after, before, skip = []) {
  const starts = [0]
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1)
  const toIndex = (p) => (p ? (starts[p.line - 1] ?? source.length) + p.column - 1 : null)
  const toPlace = (index) => {
    let line = starts.findLastIndex((s) => s <= index)
    return { line: line + 1, column: index - starts[line] + 1 }
  }
  let from = toIndex(after) ?? 0
  const to = toIndex(before) ?? source.length
  for (const passed of skip) {
    const last = [...String(passed).matchAll(WORD)].map((w) => w[0]).slice(-8)
    if (last.length < 3) continue
    const pattern = new RegExp(last.join(GAP), 'gu')
    pattern.lastIndex = from
    const m = pattern.exec(source)
    if (m && m.index < to) from = m.index + m[0].length
  }
  const words = [...String(text ?? '').matchAll(WORD)]
  let k = words.findIndex((w) => offset < w.index + w[0].length)
  if (k < 0) k = words.length - 1
  if (k >= 0) {
    const lo = Math.max(0, k - 4)
    // Words are letters and digits only, so they need no escaping in a pattern.
    for (const [list, at] of [[words.slice(lo, k + 5), k - lo], [[words[k]], 0]]) {
      const body = list.map((w, i) => (i === at ? `(?<word>${w[0]})` : w[0])).join(GAP)
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'gdu')
      const hits = [...source.matchAll(pattern)].map((m) => m.indices.groups.word[0])
      // one or two words are too common to look for anywhere but between the two
      const hit = hits.find((i) => i >= from && i < to) ?? (list.length >= 3 ? hits[0] : undefined)
      if (hit != null) return toPlace(hit + Math.min(Math.max(0, offset - words[k].index), words[k][0].length))
    }
  }
  const tag = source.slice(from, to).search(/<[A-Z]/)
  if (tag >= 0) return toPlace(from + tag)
  return after ?? { line: 1, column: 1 }
}

// The column in `line` (a line of the file) of the word clicked, from the words around the caret (`text`, `offset`): the
// place of that word nearest `column`, which the page counted from text that may differ from the file's.
function snapColumn(line, column, text, offset) {
  const word = [...String(text ?? '').matchAll(WORD)].find((w) => offset < w.index + w[0].length)
  if (!word) return column
  const places = [...line.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${word[0]}(?![\\p{L}\\p{N}_])`, 'gu'))].map((m) => m.index)
  if (!places.length) return column
  const nearest = places.reduce((a, b) => (Math.abs(b + 1 - column) < Math.abs(a + 1 - column) ? b : a))
  return nearest + Math.min(Math.max(0, offset - word.index), word[0].length) + 1
}

// The file a request names, if it is one of the blog's or the engine's.
function sourceFile(root, name) {
  const file = realpathSync(resolve(root, String(name ?? '')))
  const inside = [root, ENGINE].some((dir) => file.startsWith(dir + sep))
  if (!inside || !statSync(file).isFile()) throw new Error(`${name} is not a file of this blog`)
  return file
}

export default function jumpToSource() {
  let root = ''
  return {
    name: 'jump-to-source',
    hooks: {
      'astro:config:setup': ({ command, config, injectScript }) => {
        setSourcePositions(command === 'dev')
        if (command !== 'dev') return
        root = realpathSync(fileURLToPath(config.root))
        injectScript('page', `import ${JSON.stringify(CLIENT)}`)
      },
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use(async (req, res, next) => {
          if (!(req.url ?? '').split('?')[0].endsWith(ENDPOINT)) return next()
          const reply = (status, data) => {
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(data))
          }
          // Only the page's own requests: a POST of JSON from the same origin.
          if (req.method !== 'POST' || !/^application\/json\b/.test(req.headers['content-type'] ?? '')) return reply(405, { error: 'POST JSON only' })
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'wrong origin' })
          let raw = ''
          for await (const chunk of req) {
            raw += chunk
            if (raw.length > 1e5) return reply(413, { error: 'too large' })
          }
          try {
            const body = JSON.parse(raw)
            const file = sourceFile(root, body.file)
            const now = (p) => p && moveToNow(file, body.version, Math.max(1, p.line | 0), Math.max(1, p.column | 0))
            const source = readFileSync(file, 'utf8')
            let { line, column } = body.line != null ? now(body) : findWords(source, body.text, body.offset | 0, now(body.after), now(body.before), [].concat(body.skip ?? []))
            if (body.line != null && body.text) column = snapColumn(source.split('\n')[line - 1] ?? '', column, body.text, body.offset | 0)
            const away = remote()
            const opened = away && !SETTING && await openInVSCode(file, line, column)
            reply(200, { opened, file, line, column, remote: away, host: hostname() })
          } catch (error) {
            logger.warn(`jump to source: ${error.message}`)
            reply(400, { error: error.message })
          }
        })
      },
    },
  }
}
