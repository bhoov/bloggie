// The live update's server half (an Astro integration), under `npm run dev` only. On a save, Astro and Vite
// reload every open page, whichever post the file belongs to: for a file that only the server uses (a post's
// index.mdx, its data, a component it renders), for code that some page runs (a figure's .svelte or .js), and,
// once any page has failed to render, for a save of any file at all. This integration sends each page that can
// draw a change itself a `live:change` instead, with the code that the save changed. A page that runs that code
// reloads, since only a reload can put new code in; every other page fetches its new render and swaps in what
// changed (client.js), so an open post that the save does not change stays as it is. A page that has not said it
// can do this (a deck, Astro's error page) gets the reload as before, and so does a page whose dependencies Vite
// has bundled again since it loaded them.
//
// List it before slideEditor() in astro.config.mjs: each wraps the server's send, and the slide
// editor must see the reloads of its own writes first, to drop them (bloggie/editor/integration.js).
import { fileURLToPath } from 'node:url'
import { capture } from './capture.js'

const CLIENT = fileURLToPath(new URL('./client.js', import.meta.url))
// The page as the server rendered it, before the page's scripts change it: the document is parsed
// ("interactive") before any module script runs. The browser keeps a record of each module the page
// loads (client.js reads it), by default of 250 fetches; a post loads up to 61 now (the maze post).
const SNAPSHOT = `performance.setResourceTimingBufferSize(100000)
document.addEventListener('readystatechange', function snap() {
  if (document.readyState !== 'interactive') return
  document.removeEventListener('readystatechange', snap)
  window.__liveRender = (${capture})(document)
})`

export default function liveUpdate() {
  const ready = new WeakMap() // the socket of each page that draws a change itself -> the dependencies it loaded

  return {
    name: 'live-update',
    hooks: {
      'astro:config:setup': ({ command, injectScript }) => {
        if (command !== 'dev') return
        injectScript('head-inline', SNAPSHOT)
        injectScript('page', `import ${JSON.stringify(CLIENT)}`)
      },
      'astro:server:setup': ({ server }) => {
        const browser = server.environments.client
        const deps = () => browser.depsOptimizer?.metadata?.browserHash
        server.ws.on('live:ready', (_, client) => ready.set(client.socket, deps()))
        const send = server.ws.send.bind(server.ws)
        server.ws.send = (payload, ...rest) => {
          // Anything but a reload of every page (a reload of one .html file, an update) goes out as it is.
          if (payload?.type !== 'full-reload' || (payload.path ?? '*') !== '*') return send(payload, ...rest)
          // Vite names the file whose code pages run (triggeredBy); Astro's reloads name none. A page that loaded
          // one of the file's modules runs the old code: each module a page imports, a figure's .svelte, a
          // module it imports, its worker's, is a fetch of its own (client.js).
          const modules = payload.triggeredBy ? browser.moduleGraph.getModulesByFile(payload.triggeredBy) ?? [] : []
          const reload = [...new Set([...modules].map((mod) => mod.url.split('?')[0]))]
          for (const client of server.ws.clients) {
            if (client.socket.readyState !== 1) continue
            const live = ready.has(client.socket) && ready.get(client.socket) === deps()
            client.send(live ? { type: 'custom', event: 'live:change', data: { reload } } : payload)
          }
        }
      },
    },
  }
}
