// HTML helpers for the figures' describe.js files, which write the text that replaces each interactive
// figure in the agent download (bloggie/scripts/export-posts.js). Run in Node at build time, never in the page.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Two decimals; values below 0.005 in magnitude print as 0.00, not -0.00.
export const f2 = (x) => (Math.abs(x) < 5e-3 ? '0.00' : x.toFixed(2))
export const vec = (v) => v.map(f2).join(' ')

export const table = (head, rows) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`

export const matrix = (m) => `<pre>${esc(m.map((row) => row.map((x) => String(x).padStart(4)).join('')).join('\n'))}</pre>`

export const pre = (text) => `<pre>${esc(text)}</pre>`
