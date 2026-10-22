// Numerical helpers shared by several figures. Plain functions on arrays; no dependencies, no I/O.
// Each figure keeps its own numerics beside its component, in src/figures/<figure>/.

export const sub = (u, v) => u.map((ui, i) => ui - v[i])
export const norm = (u) => Math.hypot(...u)

export const softmax = (scores) => {
  const m = Math.max(...scores)
  const e = scores.map((s) => Math.exp(s - m))
  const z = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / z)
}

// Deterministic RNG so every reader sees the same trajectory.
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function onehot(n, i) {
  return Array.from({ length: n }, (_, k) => Number(k === i))
}

export const argmax = (values) => values.indexOf(Math.max(...values))

export const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)

export const logSumExp = (z) => {
  const m = Math.max(...z)
  return m + Math.log(z.reduce((s, zi) => s + Math.exp(zi - m), 0))
}

// Euclidean projection onto {p >= 0, sum(p) = 1} (simplex projection).
export function projectSimplex(values) {
  const sorted = values.slice().sort((a, b) => b - a)
  let sum = 0, threshold = 0
  for (let j = 0; j < sorted.length; j++) {
    sum += sorted[j]
    const candidate = (sum - 1) / (j + 1)
    if (sorted[j] > candidate) threshold = candidate
  }
  return values.map(value => Math.max(0, value - threshold))
}

// --- finite-difference check (run from node, not from the page) -----------

export function numericGrad(f, x, h = 1e-5) {
  return x.map((_, i) => {
    const up = x.slice()
    const dn = x.slice()
    up[i] += h
    dn[i] -= h
    return (f(up) - f(dn)) / (2 * h)
  })
}

export function maxGradError(f, grad, points) {
  return Math.max(...points.map((x) => norm(sub(grad(x), numericGrad(f, x)))))
}
