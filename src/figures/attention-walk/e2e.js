// The attention walk: at loop 0 the walker is on its start, and after the last loop it is on the flag.
// Run by bloggie/e2e/run.js (bloggie/e2e/figures.js loads it); see bloggie/e2e/figures.js for what a check file exports.
import { $island, setRange, readout, expect } from '../../../bloggie/e2e/helpers.js'

async function attentionWalk(page, i) {
  // The start and the flag, from the node titles the graph draws ("F (start) -- …", "… H (flag)").
  const titles = await page.evaluate(`[...${$island(i)}.querySelectorAll('title')].map((t) => t.textContent)`)
  const start = titles.map((t) => t.match(/^([A-Z]) \(start\)/)?.[1]).find(Boolean)
  const flag = titles.map((t) => t.match(/\b([A-Z]) \(flag\)/)?.[1]).find(Boolean)
  expect(start && flag, `could not read the start and flag from the graph (titles: ${titles.slice(0, 4).join(' | ')})`)
  const loops = Number(await page.evaluate(`${$island(i)}.querySelector('input[aria-label="loop iteration"]').max`))
  const path = []
  for (let t = 0; t <= loops; t++) {
    await page.evaluate(setRange(i, 'loop iteration', t))
    path.push(((await page.evaluate(readout(i))).match(/walker at ([A-Z])/) ?? [])[1])
  }
  expect(path[0] === start, `loop 0 is at ${path[0]}, not the start ${start}`)
  expect(path.at(-1) === flag, `after ${loops} loops the walker is at ${path.at(-1)}, not the flag ${flag}`)
  return { start, flag, path: path.join(' ') }
}

export const checks = { AttentionWalk: attentionWalk }
