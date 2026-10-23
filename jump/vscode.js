// Jump to source: open a file at a line in a VS Code window that is connected to this machine (Remote - SSH).
//
// In a terminal of such a window, `code -g file:12:5` sends one HTTP request over a Unix socket, which the window's
// VS Code server names in $VSCODE_IPC_HOOK_CLI: `vscode-ipc-<id>.sock`, in its temporary folder. The window then opens
// the file on the author's own computer. This sends the same request, so the dev server needs no host name: the
// window already knows how it reached this machine. The sockets of a window that has disconnected stay for some hours
// and do not answer; a request to list the extensions (`code --list-extensions`) tells the two apart in under a second,
// and has no effect.
import http from 'node:http'
import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROBE_MS = 2000 // a connected window lists its extensions in about 0.4 s
const OPEN_MS = 5000

function request(socketPath, message, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: '/', method: 'POST', timeout, headers: { 'content-type': 'application/json', accept: 'application/json' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => (res.statusCode === 200 ? resolve(body) : reject(new Error(`VS Code answered ${res.statusCode}: ${body}`))))
    })
    req.on('timeout', () => req.destroy(new Error('VS Code did not answer')))
    req.on('error', reject)
    req.end(JSON.stringify(message))
  })
}

// This user's VS Code sockets on this machine, newest first; the one this process was started with first of all.
function sockets() {
  const uid = process.getuid?.()
  const dirs = [...new Set([process.env.XDG_RUNTIME_DIR, uid != null && `/run/user/${uid}`, tmpdir(), '/tmp'].filter(Boolean))]
  const found = []
  for (const dir of dirs) {
    let names = []
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!/^vscode-ipc-.*\.sock$/.test(name)) continue
      try {
        const stat = statSync(join(dir, name))
        if (stat.isSocket() && (uid == null || stat.uid === uid)) found.push({ path: join(dir, name), time: stat.mtimeMs })
      } catch {}
    }
  }
  const own = process.env.VSCODE_IPC_HOOK_CLI
  return [...new Set([own, ...found.sort((a, b) => b.time - a.time).map((s) => s.path)].filter(Boolean))]
}

// The socket of a connected window that answers first, or null. With several windows connected, VS Code decides which
// one opens the file.
function connected() {
  return Promise.any(sockets().map((path) => request(path, { type: 'extensionManagement', list: {} }, PROBE_MS).then(() => path))).catch(() => null)
}

const TRUST_MS = 60000 // how long a socket that answered the probe counts as a connected window's
let last = null // { path, time } of the socket that answered last

// Open `file` (absolute) at `line` and `column` (from 1). Resolves to whether a window opened it.
export async function openInVSCode(file, line, column) {
  if (!last || Date.now() - last.time > TRUST_MS) {
    const path = await connected()
    last = path && { path, time: Date.now() }
  }
  if (!last) return false
  try {
    await request(last.path, { type: 'open', fileURIs: [`${pathToFileURL(file).href}:${line}:${column}`], folderURIs: [], gotoLineMode: true }, OPEN_MS)
    return true
  } catch {
    last = null
    return false
  }
}
