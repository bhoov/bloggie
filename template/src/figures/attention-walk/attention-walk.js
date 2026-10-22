// A walker on a graph, moved by one attention head applied in a loop (AttentionWalk.svelte).
//
// Each node of the graph is a token [id; next]: two one-hot halves, the node itself and the node its arrow points
// to. The walker is a belief over nodes in the id half, [b; 0]. One loop is one attention step: the query keeps the
// walker's id half, every key is the full token, and every value moves the token's next half into the id half. So
// each loop replaces the belief with the next pointer of the node it matches, and the walker follows one arrow.
import { dot, mulberry32, onehot, softmax } from 'bloggie/lib/math.js'

// Nodes are named A, B, C…: a letter reads as a name, where 0, 1, 2… invite reading the arrows as a numbering.
export const letterOf = (i) => String.fromCharCode(65 + i)

// A uniformly random single n-cycle: every node has one arrow in and one out, and every node reaches every other.
export function permutationCycle(n, rng) {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const next = Array(n)
  order.forEach((node, i) => { next[node] = order[(i + 1) % n] })
  return next
}

// The cycle with the flag's arrow pointing to itself: a walker that reaches the flag stays there.
export function walkGraph({ n = 8, seed = 1, flag = 0 } = {}) {
  const cycle = permutationCycle(n, mulberry32(seed))
  const arrows = cycle.slice()
  arrows[flag] = flag
  return { n, arrows, cycle, flag }
}

const matvec = (matrix, vector) => matrix.map((row) => dot(row, vector))

// W_Q = [I 0; 0 0], W_K = I, W_V = [0 I; 0 0], on 2n coordinates.
export function projections(n) {
  const matrix = (entry) => Array.from({ length: 2 * n }, (_, i) => Array.from({ length: 2 * n }, (_, j) => Number(entry(i, j))))
  return {
    query: matrix((i, j) => i < n && i === j),
    key: matrix((i, j) => i === j),
    value: matrix((i, j) => i < n && j === i + n),
  }
}

// One attention step: softmax(β q·k) over the node tokens, then the weighted average of their values.
export function attentionStep(walker, arrows, beta, w = projections(arrows.length)) {
  const n = arrows.length
  const tokens = arrows.map((next, m) => [...onehot(n, m), ...onehot(n, next)])
  const query = matvec(w.query, walker)
  const weights = softmax(tokens.map((token) => beta * dot(query, matvec(w.key, token))))
  const values = tokens.map((token) => matvec(w.value, token))
  const next = Array.from({ length: 2 * n }, (_, i) => weights.reduce((sum, wm, m) => sum + wm * values[m][i], 0))
  return { walker: next, belief: next.slice(0, n) }
}

// The walker at loop 0 (one-hot on the start) and after each of `steps` loops.
export function trajectory({ n, arrows, start, beta, steps }) {
  const w = projections(n)
  const walker = onehot(2 * n, start)
  const frames = [{ walker, belief: walker.slice(0, n) }]
  for (let t = 0; t < steps; t++) frames.push(attentionStep(frames[t].walker, arrows, beta, w))
  return frames
}
