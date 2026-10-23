// A headless Chromium driven through the DevTools protocol, with no npm dependency. The browser is
// $CHROME if set, else the first one found: Playwright's cached Chromium ($PLAYWRIGHT_BROWSERS_PATH,
// $XDG_CACHE_HOME or the home cache), Google Chrome, or Chromium.
// The protocol runs over a pipe, not a port: when the runner ends, however it ends (a crash, Ctrl+C, a kill -9),
// the pipe closes and the browser quits with it. A browser on a port outlived a killed runner, and they piled up.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const candidates = []
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.XDG_CACHE_HOME && join(process.env.XDG_CACHE_HOME, 'ms-playwright'),
    join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')].filter(Boolean)
  for (const cache of caches) {
    if (!existsSync(cache)) continue
    for (const dir of readdirSync(cache).sort().reverse()) {
      if (dir.startsWith('chromium_headless_shell-')) {
        candidates.push(join(cache, dir, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'), join(cache, dir, 'chrome-headless-shell-linux64/chrome-headless-shell'))
      }
    }
  }
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  )
  const found = candidates.find(existsSync)
  if (!found) throw new Error('e2e: no Chromium found. Set CHROME to a Chrome or Chromium executable.')
  return found
}

// A profile is named after the runner's process id. The browser quits with its runner, but a killed runner cannot
// remove its profile, so each launch removes those whose runner is gone. Another user's runner (EPERM) is alive.
function removeStaleProfiles() {
  const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
  for (const name of readdirSync(tmpdir())) {
    const pid = Number(/^e2e-chrome-(\d+)-/.exec(name)?.[1])
    if (pid && !alive(pid)) try { rmSync(join(tmpdir(), name), { recursive: true, force: true }) } catch {}
  }
}

export async function launch() {
  const executable = findChrome()
  removeStaleProfiles()
  const profile = mkdtempSync(join(tmpdir(), `e2e-chrome-${process.pid}-`))
  // Linux only. Ubuntu 23.10+ (and GitHub's Ubuntu runners) forbid the user namespaces Chromium's sandbox needs,
  // and it aborts; the browser only opens this site's own pages, so run it without the sandbox there. A container's
  // /dev/shm is often 64 MB, too small to draw the tall viewport below, and the page hangs; use /tmp instead.
  const restricted = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
  const linux = process.platform !== 'linux' ? [] : [
    '--disable-dev-shm-usage',
    ...(existsSync(restricted) && readFileSync(restricted, 'utf8').trim() === '1' ? ['--no-sandbox'] : []),
  ]
  // --remote-debugging-pipe: the browser reads commands on its fd 3 and writes replies and events on its fd 4.
  const proc = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', ...linux, `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const browser = connect(proc)
  const timer = setTimeout(() => proc.kill(), 10000)
  const version = await browser.send('Browser.getVersion').catch(() => null)
  clearTimeout(timer)
  if (!version) { proc.kill(); rmSync(profile, { recursive: true, force: true }); throw new Error(`e2e: ${executable} did not start`) }
  return {
    version: version.product,
    newPage: (viewport) => openPage(browser, viewport),
    async close() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise((resolve) => proc.once('exit', resolve))
        proc.kill()
        await exited
      }
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

// One DevTools connection to the browser. Each message is JSON ending in a NUL byte. A tab is a session on the
// connection (Target.attachToTarget with flatten): its commands and events carry its sessionId.
function connect(proc) {
  const [, , , input, output] = proc.stdio
  let id = 0
  let partial = ''
  const pending = new Map()
  const sessions = new Map() // sessionId -> the tab's event handler
  output.setEncoding('utf8')
  output.on('data', (chunk) => {
    const texts = chunk.split('\0')
    texts[0] = partial + texts[0]
    partial = texts.pop()
    for (const text of texts) {
      const m = JSON.parse(text)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else if (m.sessionId) sessions.get(m.sessionId)?.(m)
    }
  })
  // When the browser quits, its pipe ends with an error; a command still waiting for a reply fails rather than hangs.
  for (const stream of [input, output]) stream.on('error', () => {})
  proc.once('exit', () => { for (const done of pending.values()) done({ error: { message: 'the browser quit' } }); pending.clear() })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    input.write(JSON.stringify({ id: i, method, params, sessionId }) + '\0')
  })
  return { send, sessions }
}

// viewport defaults to a tall one that puts every figure on screen at once, so client:visible islands all hydrate.
async function openPage(browser, { width = 1280, height = 16000, dark = false } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const problems = [] // exceptions, console errors, failed loads
  const navigations = [] // the URL of each navigation the page asks for, such as a vscode:// link, which a headless browser does not follow
  let onEvent = (m) => {
    if (m.method === 'Page.frameRequestedNavigation') navigations.push(m.params.url)
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`)
    // Chrome asks for /favicon.ico by itself; the site has none, and on Pages that path is outside the site.
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/\/favicon\.ico$/.test(m.params.entry.url ?? '')) problems.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`.trim())
  }
  browser.sessions.set(sessionId, (m) => onEvent(m))
  const send = (method, params = {}) => browser.send(method, params, sessionId)
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(`evaluate: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    return result.value
  }
  await Promise.all([send('Runtime.enable'), send('Page.enable'), send('Log.enable')])
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  return {
    problems,
    navigations,
    evaluate,
    async goto(url) {
      problems.length = 0
      navigations.length = 0
      const loaded = new Promise((resolve) => { const on = onEvent; onEvent = (m) => { on(m); if (m.method === 'Page.loadEventFired') { onEvent = on; resolve() } } })
      const { loaderId } = await send('Page.navigate', { url })
      // To the page already open with another #hash (or the same), Chrome only moves to the hash: no loaderId and no
      // load event. Reload it, so that goto always gives a freshly loaded page.
      if (!loaderId) await send('Page.reload')
      await loaded
    },
    // Poll `expression` until it is truthy; return its value, or throw after `timeout` ms.
    async waitFor(expression, { timeout = 20000, what = expression } = {}) {
      const end = Date.now() + timeout
      for (;;) {
        const value = await evaluate(expression)
        if (value) return value
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
        await sleep(100)
      }
    },
    async screenshot(selector) {
      const clip = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 16), width: innerWidth, height: Math.min(1400, r.height + 32), scale: 1 } })()`)
      return Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })).data, 'base64')
    },
    // A DevTools protocol command, such as Input.dispatchMouseEvent for real mouse and key input.
    cdp: send,
    // Closes the tab itself, not only its connection: a tab left open stays in front, and the browser then pauses
    // animation frames in every other tab, so figures there would never move.
    close: async () => {
      browser.sessions.delete(sessionId)
      await browser.send('Target.closeTarget', { targetId }).catch(() => {})
    },
  }
}
