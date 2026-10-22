import assert from 'node:assert/strict'
import test from 'node:test'
import { mulberry32, onehot, argmax, maxGradError } from '../../../bloggie/lib/math.js'
import { permutationCycle, pointerChaseGraph, energyValue, pointerEnergyGrad, energyStep, energyTrajectory, jointEnergy, jointEnergyGrad, jointStep, twoSlotTrajectory, transformerStep } from './pointer-chase.js'

test('the analytical gradient matches central finite differences, at several walker states', () => {
  const rng = mulberry32(3)
  const arrows = permutationCycle(6, rng)
  const points = [
    [...onehot(6, 0), ...Array(6).fill(0)],
    [0.2, 0.1, 0.3, 0.05, 0.15, 0.2, 0.1, 0.05, 0.2, 0.15, 0.3, 0.1],
    Array.from({ length: 12 }, (_, i) => Math.sin(i + 1) * 0.4),
  ]
  for (const [a, b, beta] of [[1, 1, 4], [1, -1, 2], [0.5, 2, 8]]) {
    const error = maxGradError(
      (x) => energyValue(x, arrows, a, b, beta),
      (x) => pointerEnergyGrad(x, arrows, a, b, beta),
      points
    )
    assert.ok(error < 1e-6, `gradient error ${error} too large for a=${a}, b=${b}, beta=${beta}`)
  }
})

test('gradient descent lowers the energy at every step', () => {
  const rng = mulberry32(11)
  const arrows = permutationCycle(8, rng)
  let walker = [...onehot(8, 3), ...Array(8).fill(0)]
  let before = energyValue(walker, arrows, 1, 1, 5)
  for (let t = 0; t < 15; t++) {
    walker = energyStep(walker, arrows, 1, 1, 5, 0.5).walker
    const after = energyValue(walker, arrows, 1, 1, 5)
    assert.ok(after <= before + 1e-10, `energy rose from ${before} to ${after} at step ${t}`)
    before = after
  }
})

// The claim the whole figure exists to demonstrate: because `arrows` is
// (almost) a bijection, a single slot's energy descent can never leave its
// start. a = 1 is fixed at the value the demo ships (it is what keeps the
// id half a valid probability distribution -- see the test above); b and
// beta are swept across the demo's own slider range and every possible
// start. a < 1 is a different, non-demonstrated failure mode: D_id = a . w
// no longer sums to 1, so the id half loses mass each step and decays
// toward a near-uniform blur where argmax is tie-breaking noise, not a real
// escape -- see the flag-collision test below for the other boundary this
// grid is chosen to stay clear of.
test('a single slot never leaves its start, across a grid of designs and every start', () => {
  const graph = pointerChaseGraph({ n: 8, seed: 5, flag: 7 })
  const a = 1
  const bGrid = [0.15, 0.25, 0.4, 0.5, -0.15, -0.25, -0.4, -0.5]
  const betas = [0.5, 1, 3, 12] // 0.5 and 12 are the demo's own slider bounds
  let runs = 0
  for (const b of bGrid) {
    for (const beta of betas) {
      for (let start = 0; start < graph.n; start++) {
        const frames = energyTrajectory({ n: graph.n, arrows: graph.arrows, start, beta, steps: 9, a, b, eta: 0.5 })
        for (const frame of frames) assert.equal(argmax(frame.belief), start)
        runs++
      }
    }
  }
  assert.equal(runs, bGrid.length * betas.length * graph.n)
})

test('the joint energy gradient matches central finite differences in both halves', () => {
  const arrows = permutationCycle(6, mulberry32(3))
  const points = [
    [...onehot(6, 0), ...Array(6).fill(0)],
    [0.2, 0.1, 0.3, 0.05, 0.15, 0.2, 0.1, 0.05, 0.2, 0.15, 0.3, 0.1],
    Array.from({ length: 12 }, (_, i) => Math.sin(i + 1) * 0.4),
  ]
  for (const beta of [1, 4, 8]) {
    const error = maxGradError(
      (x) => jointEnergy(x.slice(0, 6), x.slice(6), arrows, beta),
      (x) => { const g = jointEnergyGrad(x.slice(0, 6), x.slice(6), arrows, beta); return [...g.p, ...g.q] },
      points
    )
    assert.ok(error < 1e-6, `beta=${beta}: ${error}`)
  }
})

test('one unit q-step from zero, with p held, is the looped transformer update', () => {
  const graph = pointerChaseGraph({ n: 8, seed: 5, flag: 7 })
  const b = [0.5, 0.2, 0, 0.1, 0, 0.1, 0.1, 0]
  const { q } = jointStep(b, Array(8).fill(0), graph.arrows, 5, 1)
  const { belief } = transformerStep([...b, ...Array(8).fill(0)], graph.arrows, 5)
  q.forEach((x, i) => assert.ok(Math.abs(x - belief[i]) < 1e-12))
})

test('joint descent plus the handoff walks the default graph, with energy falling within every hop', () => {
  const graph = pointerChaseGraph({ n: 8, seed: 5, flag: 7 })
  const start = graph.cycle[graph.flag]
  const frames = twoSlotTrajectory({ ...graph, start, beta: 5, steps: 9 })
  let expected = start
  for (let t = 0; t < frames.length; t++) {
    assert.equal(argmax(frames[t].belief), expected, `p on the wrong node at hop ${t}`)
    assert.equal(argmax(frames[t].next), graph.arrows[expected], `q on the wrong node at hop ${t}`)
    expected = graph.arrows[expected]
  }
  let p = onehot(8, start)
  let q = Array(8).fill(0)
  let before = jointEnergy(p, q, graph.arrows, 5)
  for (let k = 0; k < 30; k++) {
    ;({ p, q } = jointStep(p, q, graph.arrows, 5, 0.5))
    const after = jointEnergy(p, q, graph.arrows, 5)
    assert.ok(after <= before + 1e-12, `energy rose at step ${k}`)
    before = after
  }
  assert.ok(jointEnergy(q, Array(8).fill(0), graph.arrows, 5) > before, 'the handoff should raise the energy')
})

test('every start walks every graph at beta >= 3; weak beta loses the path', () => {
  const walks = (beta) => {
    let ok = 0
    for (let seed = 0; seed < 30; seed++) {
      const graph = pointerChaseGraph({ n: 8, seed, flag: 7 })
      for (let start = 0; start < 8; start++) {
        let expected = start
        ok += twoSlotTrajectory({ ...graph, start, beta, steps: 9 }).every((frame) => {
          const good = argmax(frame.belief) === expected
          expected = graph.arrows[expected]
          return good
        })
      }
    }
    return ok
  }
  assert.equal(walks(3), 240)
  assert.ok(walks(1) < 240)
})

test('the energy has no arrow of time: clamping q and descending p finds the predecessor', () => {
  const graph = pointerChaseGraph({ n: 8, seed: 5, flag: 7 })
  const target = graph.cycle.find((node) => node !== graph.flag && graph.arrows[node] !== graph.flag)
  const predecessor = graph.arrows.indexOf(target)
  const q = onehot(8, target)
  let p = Array(8).fill(0)
  for (let k = 0; k < 30; k++) p = jointStep(p, q, graph.arrows, 5, 0.5).p
  assert.equal(argmax(p), predecessor)
})
