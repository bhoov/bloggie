// Text for the agent download: what AttentionWalk.svelte shows, with a trace from its own numerics.
import { argmax } from '../../../bloggie/lib/math.js'
import { table, vec } from '../../../bloggie/lib/describe.js'
import { letterOf as L, trajectory, walkGraph } from './attention-walk.js'

export const sources = ['bloggie/lib/math.js', 'src/figures/attention-walk/attention-walk.js']

export function describe({ params = {} }) {
  const { n = 8, seed = 5, flag = 7, beta = 5, maxSteps = 9 } = params
  const graph = walkGraph({ n, seed, flag })
  const start = graph.cycle[graph.flag]
  const frames = trajectory({ ...graph, start, beta, steps: maxSteps })
  const nodes = Array.from({ length: n }, (_, i) => L(i))
  return `<h4>Figure: one attention head, looped, walks a graph</h4>
<p>Interactive on the site: the nodes ${nodes[0]}–${nodes.at(-1)} are drawn on a circle with their arrows, and bars show the walker's belief over nodes. Buttons play or step the loop, a slider sets β (0.5–12), a click on a node sets the start, and a shuffle button draws a new graph.</p>
<p>Arrows: ${graph.arrows.map((t, i) => `${L(i)}→${L(t)}`).join(', ')}. The flag ${L(graph.flag)} points to itself. The walker starts at ${L(start)}, the node most hops from the flag (β = ${beta}).</p>
${table(['loop', ...nodes, 'argmax'], frames.map((f, t) => [t, ...f.belief.map((x) => vec([x])), L(argmax(f.belief))]))}
<p>Each loop moves the belief one arrow forward. It reaches the flag ${L(graph.flag)} and stays there.</p>`
}
