// What the live update (client.js) compares between two renders of a page: the blocks of its <main>, each
// with the HTML the server wrote for it, and the frame around them, everything else in <head> and <body>
// but what the update itself keeps in step (the head's styles, scripts, title and named <meta>).
// integration.js runs this same function in an inline script when the page is parsed, before any of the
// page's scripts change it, so it stays one plain function with nothing from outside it.
export function capture(doc) {
  const main = doc.querySelector('main')
  const head = [...doc.head.children].filter((el) => !el.matches('style, script, title, meta[name]')).map((el) => el.outerHTML)
  const body = [...doc.body.children].filter((el) => el !== main).map((el) => el.outerHTML)
  const shell = [doc.body.cloneNode(false).outerHTML, main ? main.cloneNode(false).outerHTML : '']
  return {
    blocks: main ? [...main.children].map((el) => [el, el.outerHTML]) : [],
    frame: [...shell, ...head, ...body].join('\n'),
  }
}
