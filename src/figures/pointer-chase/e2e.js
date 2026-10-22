// The pointer-chase figure: the walker (or p) reaches the flag, and a single slot never leaves the start. The
// transformer's and the two-slot energy's paths go in `walks`, for the check of the unrolled trajectory's e2e.js.
// Run by bloggie/e2e/run.js (bloggie/e2e/figures.js loads it); see bloggie/e2e/figures.js for what a check file exports.

import { $island, setRange, readout, expect } from '../../../bloggie/e2e/helpers.js'

// The start and the flag, from the node titles the graph draws ("F (start) -- …", "… H (flag)").
export async function roles(page, i) {
  const titles = await page.evaluate(`[...${$island(i)}.querySelectorAll('title')].map((t) => t.textContent)`)
  const start = titles.map((t) => t.match(/^([A-Z]) \(start\)/)?.[1]).find(Boolean)
  const flag = titles.map((t) => t.match(/\b([A-Z]) \(flag\)/)?.[1]).find(Boolean)
  expect(start && flag, `could not read the start and flag from the graph (titles: ${titles.slice(0, 4).join(' | ')})`)
  return { start, flag }
}

async function pointerChase(page, i, walks) {
  const model = await page.evaluate(`JSON.parse(${$island(i)}.getAttribute('props')).model[1]`)
  const { start, flag } = await roles(page, i)
  const loops = Number(await page.evaluate(`${$island(i)}.querySelector('input[aria-label="loop iteration"]').max`))
  await page.evaluate(setRange(i, 'loop iteration', 0))
  const path = []
  for (let t = 0; t <= loops; t++) {
    await page.evaluate(setRange(i, 'loop iteration', t))
    const line = await page.evaluate(readout(i))
    path.push((line.match(/(?:walker|p) at ([A-Z])/) ?? [])[1])
  }
  const final = path.at(-1)
  if (model === 'transformer') {
    expect(path[0] === start, `transformer: loop 0 is at ${path[0]}, not the start ${start}`)
    expect(final === flag, `transformer: after ${loops} loops the walker is at ${final}, not the flag ${flag}`)
    walks.transformer = path
  } else if (model === 'energy') {
    expect(path.every((node) => node === start), `single-slot energy: the walker left the start ${start}: ${path.join(' ')}`)
  } else if (model === 'twoSlot') {
    expect(final === flag, `two-slot energy: after ${loops} hops p is at ${final}, not the flag ${flag}`)
    walks.twoSlot = path
  } else throw new Error(`unknown PointerChase model ${model}`)
  return { model, start, flag, path: path.join(' ') }
}

export const checks = { PointerChase: pointerChase }
