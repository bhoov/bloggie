// Text for the agent download: what PointerChase.svelte shows, with traces computed by its own numerics.
// describe(props) receives the figure's props from the post; `sources` lists the code to append.
import { argmax } from '../../../bloggie/lib/math.js'
import { matrix, table, vec } from '../../../bloggie/lib/describe.js'
import {
  energyProjection, energyTrajectory, energyValue, jointEnergy, letterOf as L, pointerChaseGraph,
  transformerProjections, transformerTrajectory, twoSlotTrajectory,
} from './pointer-chase.js'

export const sources = ['bloggie/lib/math.js', 'src/figures/pointer-chase/pointer-chase.js']

// The post's graph, its default start (the node most hops from the flag) and the correct walk.
export function graphSummary({ n = 8, seed = 1, flag = 0, beta = 5 } = {}) {
  const graph = pointerChaseGraph({ n, seed, flag })
  const start = graph.cycle[graph.flag]
  const walk = [start]
  while (walk.at(-1) !== graph.flag) walk.push(graph.arrows[walk.at(-1)])
  const text = `<p><b>Graph</b> (n = ${n}, seed = ${seed}, β = ${beta}): arrows ${graph.arrows.map((t, i) => `${L(i)}→${L(t)}`).join(', ')}. The flag is ${L(graph.flag)}; its arrow points to itself. The default start is ${L(start)}, the node most hops from the flag. The correct walk is ${walk.map(L).join(' → ')}.</p>`
  return { graph, start, text }
}

const controls = 'Interactive on the site: the nodes A–H are drawn on a circle with their arrows, and bars show the walker\'s belief over nodes. Buttons play or step the loop, a slider sets β (0.5–12), a click on a node sets the start, and a shuffle button draws a new graph. A collapsible panel prints the matrices below.'

export function describe({ model = 'transformer', params = {}, matricesId }) {
  const { n = 8, beta = 5, maxSteps = 9 } = params
  const { graph, start, text } = graphSummary({ n: 8, seed: 1, flag: 0, ...params })
  const args = { ...graph, start, beta, steps: maxSteps }
  const nodes = Array.from({ length: n }, (_, i) => L(i))
  const tokens = graph.arrows.map((next, m) => [...nodes.map((_, k) => +(k === m)), ...nodes.map((_, k) => +(k === next))])
  // The post links to the figure's matrix panel by this id.
  const anchor = matricesId ? ` id="${matricesId}"` : ''
  const tokenMatrix = `<p>Node-token matrix G (rows A–H; the first ${n} columns are the id one-hot, the last ${n} the next one-hot):</p>${matrix(tokens)}`

  if (model === 'transformer') {
    const { query, value } = transformerProjections(n)
    const frames = transformerTrajectory(args)
    return `<h4>Figure: looped single-head attention walks the graph</h4>
<p>${controls}</p>${text}<div${anchor}>${tokenMatrix}
<p>W_Q (keeps the id half, zeros the next half):</p>${matrix(query)}
<p>W_K = I. W_V (moves the next half into the id half, zeros the next half):</p>${matrix(value)}</div>
<p>Walker belief b (the id half of p = [b; 0]) after each loop:</p>
${table(['loop', ...nodes, 'argmax'], frames.map((f, t) => [t, ...f.belief.map((x) => vec([x])), L(argmax(f.belief))]))}
<p>Each loop moves the belief one arrow forward. It reaches the flag ${L(graph.flag)} and stays there.</p>`
  }

  if (model === 'energy') {
    const [a, b, eta] = [1, 0.5, 0.5] // as in PointerChase.svelte
    const frames = energyTrajectory({ ...args, a, b, eta })
    return `<h4>Figure: single-slot energy attention stays at the start</h4>
<p>${controls}</p>${text}
<p>Each loop is one gradient step (η = ${eta}) on E(x) = ½‖x‖² − (1/β) log Σ_m exp(β xᵀ M g_m). The tied projection is W_Q = W_K (below), so M = W_Qᵀ W_K = diag(${a} on the id block, ${b} on the next block). The update is x ← x + η(Σ_m softmax_m · M g_m − x).</p>
<div${anchor}><p>W_Q = W_K:</p>${matrix(energyProjection(n, a, b))}</div>
<p>Walker after each loop:</p>
${table(['loop', 'id half (belief)', 'next half', 'argmax id', 'E'], frames.map((f, t) =>
    [t, vec(f.walker.slice(0, n)), vec(f.walker.slice(n)), L(argmax(f.belief)), energyValue(f.walker, graph.arrows, a, b, beta).toFixed(3)]))}
<p>The id half stays on the start ${L(start)}. The next half collects mass on the successor ${L(graph.arrows[start])}, but no term of the gradient moves that mass into the id half, so the walker never takes a step.</p>`
  }

  if (model === 'twoSlot') {
    const frames = twoSlotTrajectory(args)
    return `<h4>Figure: two-slot energy with an external handoff</h4>
<p>${controls} In this model the bars show p and q separately.</p>${text}<div${anchor}>${tokenMatrix}<p>W_Q = W_K = I (${2 * n}×${2 * n}).</p></div>
<p>The walker is [p; q] with W_Q = W_K = I. Each hop runs 30 joint gradient steps (η = 0.5) on E(p, q), then applies the handoff p ← q, q ← 0, which is not a descent step. State after the descent of each hop:</p>
${table(['hop', 'p (current)', 'q (next)', 'argmax p', 'argmax q', 'E(p, q)'], frames.map((f, t) =>
    [t, vec(f.belief), vec(f.next), L(argmax(f.belief)), L(argmax(f.next)), jointEnergy(f.belief, f.next, graph.arrows, beta).toFixed(3)]))}
<p>Within a hop, descent completes the stored edge: q moves to the successor of p. The handoff sets q to zero, which raises the energy, so the whole walk is not descent on one time-independent energy.</p>`
  }

  throw new Error(`PointerChase describe: unknown model "${model}"`)
}
