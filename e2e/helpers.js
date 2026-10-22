// Helpers for the figure checks (src/figures/<figure>/e2e.js). Each returns an expression that page.evaluate runs in
// the browser against the i-th astro-island on the page, except expect, which throws with the message.

export const $island = (i) => `document.querySelectorAll('astro-island')[${i}]`
export const text = (i) => `${$island(i)}.textContent`
export const click = (i, label) => `${$island(i)}.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`
export const setRange = (i, label, value) => `(() => { const el = ${$island(i)}.querySelector('input[aria-label=${JSON.stringify(label)}]'); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`
export const readout = (i) => `${$island(i)}.querySelector('.readout').textContent.replace(/\\s+/g, ' ').trim()`

export function expect(condition, message) {
  if (!condition) throw new Error(message)
}

export const choose = (i, label, value) => `(() => { const el = ${$island(i)}.querySelector('select[aria-label=${JSON.stringify(label)}]'); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change', { bubbles: true })) })()`
export const attr = (i, name) => `${$island(i)}.querySelector('[data-${name}]').dataset.${name.replace(/-(\w)/g, (_, c) => c.toUpperCase())}`
