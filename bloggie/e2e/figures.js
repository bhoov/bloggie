// What each figure must do when a reader uses it, checked through its controls and readouts only. Each figure's
// checks are in its own folder, src/figures/<figure>/e2e.js, so that they go with the figure (npm run reset deletes
// both). A check file exports
//   checks: { <Component>: (page, i, shared) => observed }. Each runs against the i-th astro-island of a page that
//     uses <Component>, returns the observed values for the report, and throws when the figure does not do what the
//     post says. `shared` is one object for all the checks on a page (the walking figures put their paths there).
//   afterPage (optional): { <check name>: (shared) => observed }, run on every page after all of its figures.
// The helpers the checks share are in bloggie/e2e/helpers.js.
import { existsSync, readdirSync } from 'node:fs'

const figures = new URL('../../src/figures/', import.meta.url)
export const checks = {}
export const afterPage = {}
for (const folder of readdirSync(figures).sort()) {
  const file = new URL(`${folder}/e2e.js`, figures)
  if (!existsSync(file)) continue
  const found = await import(file.href)
  for (const [name, check] of Object.entries(found.checks ?? {})) {
    if (checks[name]) throw new Error(`e2e: two checks for ${name} (the second in src/figures/${folder}/e2e.js)`)
    checks[name] = check
  }
  Object.assign(afterPage, found.afterPage)
}
