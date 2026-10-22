// The pointer-chase graph and the updates that walk it: looped transformer, single-slot energy attention,
// the two-slot energy, and its clamped flow (PointerChase.svelte, UnrollTrajectory.svelte).
import { dot, mulberry32, onehot, softmax, sub } from '../../../bloggie/lib/math.js'

// Nodes are named A, B, C…, not 0, 1, 2…: sequential numbers invite reading the arrows as if they
// followed the numbering (they are a random permutation), and a letter reads as a name.
export const letterOf = (i) => String.fromCharCode(65 + i)

// --- Pointer chasing on a permutation graph (looped transformer) ---------
// Node tokens and the walker share 2n coordinates: [id; next]. The walker
// is [belief; zeros]. Query projection masks the next half, keys retain the
// full node token, and values move next into id while clearing the next half.
// Each replace update therefore returns another walker in the same space.

// A uniformly random single n-cycle: every node has in-degree and out-degree
// 1 and the graph is one component, so every node reaches every other.
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

// Walk the raw cycle forward from `start`, `hops` arrows.
export function advance(next, start, hops) {
  let node = start
  for (let i = 0; i < hops; i++) node = next[node]
  return node
}

// Hops from `start` to `target` along the raw cycle (every node is reachable
// within n steps, since it is a single n-cycle). Used for the readout and to
// tell when the walker has been absorbed, for whichever start the reader
// picked -- the flag itself never moves.
export function hopsTo(next, start, target, maxHops = next.length) {
  let node = start
  for (let h = 0; h <= maxHops; h++) {
    if (node === target) return h
    node = next[node]
  }
  return null
}

// A graph with one node's arrow overridden to point to itself: reaching it
// is a true fixed point of the walk, not just a step the reader stops at.
// The flag is a fixed node id, independent of wherever the walker starts.
export function pointerChaseGraph({ n = 8, seed = 1, flag = 0 } = {}) {
  const rng = mulberry32(seed)
  const cycle = permutationCycle(n, rng)
  const arrows = cycle.slice()
  arrows[flag] = flag
  return { n, arrows, cycle, flag }
}

// Square projections shared by the computation and the matrix inspector.
// Vectors are columns: W_Q = [I 0; 0 0], W_K = I, W_V = [0 I; 0 0].
export function transformerProjections(n) {
  const matrix = (entry) => Array.from({ length: 2 * n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) => Number(entry(i, j))))
  return {
    query: matrix((i, j) => i < n && i === j),
    key: matrix((i, j) => i === j),
    value: matrix((i, j) => i < n && j === i + n),
  }
}

const matvec = (matrix, vector) => matrix.map((row) => dot(row, vector))

// One attention-only replace update on a 2n-dimensional walker. beta includes
// the usual inverse-square-root head-width scaling. Only graph tokens are keys
// and values; the walker does not attend to itself.
export function transformerStep(walker, arrows, beta, projections = transformerProjections(arrows.length)) {
  const n = arrows.length
  if (walker.length !== 2 * n) throw new RangeError('The walker must have 2n coordinates: [belief; zeros].')
  const tokens = arrows.map((next, m) => [...onehot(n, m), ...onehot(n, next)])
  const query = matvec(projections.query, walker)
  const scores = tokens.map((token) => beta * dot(query, matvec(projections.key, token)))
  const weights = softmax(scores)
  const values = tokens.map((token) => matvec(projections.value, token))
  const next = Array.from({ length: 2 * n }, (_, i) => weights.reduce((sum, w, m) => sum + w * values[m][i], 0))
  return { walker: next, belief: next.slice(0, n), weights }
}

export function transformerTrajectory({ n, arrows, start, beta, steps }) {
  const projections = transformerProjections(n)
  const walker = onehot(2 * n, start)
  const frames = [{ walker, belief: walker.slice(0, n), weights: null }]
  for (let t = 0; t < steps; t++) {
    frames.push(transformerStep(frames[t].walker, arrows, beta, projections))
  }
  return frames
}

// --- Raw energy attention on the same graph (single slot) ----------------
// Ties match and write to one matrix M: E(x) = ||x||^2/2 - (1/beta) log
// sum_m exp(beta x^T M g_m), with M block-diagonal -- scalar a on the id
// block, b on the next block, the only permutation-equivariant single-slot
// design (see am-energy-design / the plan this implements). -grad E is the
// softmax-weighted average of M g_m minus x: a relaxation toward that
// average, not a free replace -- the write is literally the gradient of the
// same score that did the matching, unlike transformerStep's independent
// key and value. Because `arrows` is a bijection, matching the next half
// against "whichever node's own next equals mine" can only ever re-select
// the node the id half already matched, so a single slot never leaves its
// start; see the finite-difference and stuck-at-start checks in the test
// file for both the gradient and this claim.

function energyScores(walker, arrows, a, b, beta) {
  const n = arrows.length
  const idPart = walker.slice(0, n)
  const nextPart = walker.slice(n)
  return Array.from({ length: n }, (_, m) => beta * (a * idPart[m] + b * nextPart[arrows[m]]))
}

export function energyValue(walker, arrows, a, b, beta) {
  const self = walker.reduce((s, x) => s + x * x, 0) / 2
  const z = energyScores(walker, arrows, a, b, beta)
  const m = Math.max(...z)
  const lse = m + Math.log(z.reduce((s, zi) => s + Math.exp(zi - m), 0))
  return self - lse / beta
}

// D(x): the softmax-weighted average of M g_m, the attractor -grad E
// relaxes toward. a lands directly on the id half (a=1 keeps it a valid
// probability distribution: D_id is then itself a convex combination of
// one-hot vectors, and so is every subsequent x_id under relaxation); b
// scatters through `arrows` into the next half.
export function energyAttractor(walker, arrows, a, b, beta) {
  const n = arrows.length
  const weights = softmax(energyScores(walker, arrows, a, b, beta))
  const attractor = Array(2 * n).fill(0)
  weights.forEach((w, m) => {
    attractor[m] += a * w
    attractor[arrows[m] + n] += b * w
  })
  return { attractor, weights }
}

// grad E(x) = x - D(x), kept separate from the energy and from the step so
// each is independently testable (AGENTS.md: check descent with finite
// differences).
export const pointerEnergyGrad = (walker, arrows, a, b, beta) => {
  const { attractor } = energyAttractor(walker, arrows, a, b, beta)
  return sub(walker, attractor)
}

// One gradient-descent step, x <- x + eta (D(x) - x) = x - eta grad E(x):
// a relaxation, sharing refineStep's convention (sigma = 0, no noise), not
// a replace -- the walker keeps most of its own state every loop.
export function energyStep(walker, arrows, a, b, beta, eta) {
  const { attractor, weights } = energyAttractor(walker, arrows, a, b, beta)
  const next = walker.map((x, i) => x + eta * (attractor[i] - x))
  return { walker: next, belief: next.slice(0, arrows.length), weights }
}

// b = 0.5, not 1: the flag's self-loop override makes `arrows` a 2-to-1
// collision exactly at the flag (its predecessor and the flag itself both
// scatter into x_next[flag]), which strict injectivity elsewhere in the
// graph does not have. At weak beta and |b| close to 1 that doubled bucket
// can out-vote a distant start; b = 0.5 stays clear of that regime across
// the demo's whole beta range. See the two dedicated tests for this.
export function energyTrajectory({ n, arrows, start, beta, steps, a = 1, b = 0.5, eta = 0.5 }) {
  const walker = [...onehot(n, start), ...Array(n).fill(0)]
  const frames = [{ walker, belief: walker.slice(0, n), weights: null }]
  for (let t = 0; t < steps; t++) {
    frames.push(energyStep(frames[t].walker, arrows, a, b, beta, eta))
  }
  return frames
}

// W_Q = W_K, for the inspector: block-diagonal, scalar sqrt(a) on the id
// block and sqrt(b) on the next block, so that W_Q^T W_K = diag(a, b) -- the
// energy's actual score/write matrix -- without ever forming that collapsed
// product explicitly. Values are display strings, not floats: an integer
// sqrt (a = 1) prints as "1"; an irrational one (b = 0.5) prints as "√0.5"
// rather than a rounded decimal, matching the sqrt(a), sqrt(b) notation in
// the write-up directly instead of hiding it behind 0.707.
export function energyProjection(n, a, b) {
  const label = (x) => {
    const root = Math.sqrt(x)
    return Number.isInteger(root) ? String(root) : `√${x}`
  }
  const s = label(a)
  const t = label(b)
  return Array.from({ length: 2 * n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) => (i !== j ? 0 : i < n ? s : t)))
}

// --- Two-slot pointer chase -----------------------------------------------
// The walker's halves get their own names: p, a belief over the current
// node, and q, a belief over the next node. The joint energy is the
// single-slot energy above with a = b = 1 (W_Q = W_K = I), read on [p; q]:
//   E(p, q) = ||p||²/2 + ||q||²/2 - (1/beta) log sum_m exp(beta (p·id_m + q·next_m)).
// Both halves descend it together; low energy means [p; q] looks like a
// stored edge. The handoff p <- q, q <- 0 starts the next hop and is not
// energy descent: it is the only step that knows which way time runs.

export const jointEnergy = (p, q, arrows, beta) => energyValue([...p, ...q], arrows, 1, 1, beta)

export function jointEnergyGrad(p, q, arrows, beta) {
  const grad = pointerEnergyGrad([...p, ...q], arrows, 1, 1, beta)
  return { p: grad.slice(0, p.length), q: grad.slice(p.length) }
}

export function jointStep(p, q, arrows, beta, eta) {
  const grad = jointEnergyGrad(p, q, arrows, beta)
  return { p: p.map((x, i) => x - eta * grad.p[i]), q: q.map((x, i) => x - eta * grad.q[i]) }
}

export const handoff = (p, q) => ({ p: q, q: q.map(() => 0) })

// Frame t is hop t after joint descent: p settled on the current node, q on
// the next. Both beliefs are recorded so the figure can draw them apart. The
// handoff happens between frames.
export function twoSlotTrajectory({ n, arrows, start, beta, steps, relaxSteps = 30, eta = 0.5 }) {
  let state = { p: onehot(n, start), q: Array(n).fill(0) }
  const frames = []
  for (let t = 0; t <= steps; t++) {
    let { p, q } = state
    for (let k = 0; k < relaxSteps; k++) ({ p, q } = jointStep(p, q, arrows, beta, eta))
    frames.push({ walker: [...p, ...q], belief: p, next: q, weights: null })
    state = handoff(p, q)
  }
  return frames
}

// One Euler step of the gradient flow dq/dτ = -∇_q E(p, q) with p clamped:
// q <- q + dt (sum_m w_m next_m - q). Used to generate one token at a time,
// where the current token p is already decided and only the next token q moves.
export function clampedFlowStep(p, q, arrows, beta, dt) {
  const grad = jointEnergyGrad(p, q, arrows, beta).q
  return q.map((x, i) => x - dt * grad[i])
}
