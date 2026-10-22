import assert from 'node:assert/strict'
import test from 'node:test'
import { mulberry32, argmax } from '../../../bloggie/lib/math.js'
import { permutationCycle, hopsTo, pointerChaseGraph, transformerProjections, transformerTrajectory } from './pointer-chase.js'

test('a random permutation is a single n-cycle: n steps return to start, fewer never do', () => {
  for (const seed of [1, 2, 3, 17, 42]) {
    const rng = mulberry32(seed)
    const next = permutationCycle(8, rng)
    const seen = new Set([0])
    let node = 0
    for (let i = 1; i < 8; i++) {
      node = next[node]
      assert.ok(!seen.has(node), `cycle closed early at step ${i} for seed ${seed}`)
      seen.add(node)
    }
    assert.equal(next[node], 0)
    assert.equal(seen.size, 8)
  }
})

test('iterating the loop walks the belief around the graph and it is absorbed at the flag, for any start', () => {
  const beta = 8
  const graph = pointerChaseGraph({ n: 8, seed: 5, flag: 7 })
  for (const start of [0, 2, 6]) {
    const flagHops = hopsTo(graph.cycle, start, graph.flag)
    const frames = transformerTrajectory({ n: graph.n, arrows: graph.arrows, start, beta, steps: flagHops + 5 })
    for (const frame of frames) {
      assert.equal(frame.walker.length, 2 * graph.n)
      assert.deepEqual(frame.walker.slice(0, graph.n), frame.belief)
      assert.deepEqual(frame.walker.slice(graph.n), Array(graph.n).fill(0))
      assert.ok(Math.abs(frame.belief.reduce((a, b) => a + b, 0) - 1) < 1e-10)
      assert.ok(frame.belief.every((v) => v >= -1e-12))
    }
    // The hard-argmax path matches walking the pre-override cycle to the flag, then staying.
    let node = start
    const path = [node]
    for (let t = 0; t < flagHops; t++) { node = graph.cycle[node]; path.push(node) }
    for (let t = 0; t <= flagHops; t++) assert.equal(argmax(frames[t].belief), path[t])
    for (let t = flagHops; t < frames.length; t++) assert.equal(argmax(frames[t].belief), graph.flag)
    // Finite beta means the flag's mass settles at a genuine equilibrium below
    // 1, not at 1 itself -- the residual leak the soft/hard-beta discussion
    // predicts. The test checks it is a true fixed point (unchanged one step
    // to the next) and high, not that it reaches exactly 1.
    assert.ok(frames.at(-1).belief[graph.flag] > 0.99)
    assert.ok(Math.abs(frames.at(-1).belief[graph.flag] - frames.at(-2).belief[graph.flag]) < 1e-9)
  }
})

test('square projections use only query ID coordinates and write next into the walker ID half', () => {
  const n = 3
  const { query, key, value } = transformerProjections(n)
  const apply = (matrix, vector) => matrix.map((row) => row.reduce((sum, x, j) => sum + x * vector[j], 0))
  for (const matrix of [query, key, value]) {
    assert.equal(matrix.length, 2 * n)
    assert.ok(matrix.every((row) => row.length === 2 * n))
  }
  // Nonzero next coordinates cannot contribute to the query, even if supplied.
  assert.deepEqual(apply(query, [0.2, 0.3, 0.5, 9, 8, 7]), [0.2, 0.3, 0.5, 0, 0, 0])
  const token = [0, 1, 0, 0, 0, 1]
  assert.deepEqual(apply(key, token), token)
  assert.deepEqual(apply(value, token), [0, 0, 1, 0, 0, 0])
})
