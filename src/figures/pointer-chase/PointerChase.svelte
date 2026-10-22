<!--
  The pointer-chase figure: a walker on a graph of eight nodes, updated by one of three models.

  <PointerChase client:visible model="transformer" params={pointerChaseParams} matricesId="pointer-chase-matrices" />

  model       "transformer": a looped attention head replaces the belief with the matched next pointer.
              "energy":      one gradient step of single-slot energy attention per loop; it never leaves the start.
              "twoSlot":     joint descent of E(p, q) on a current and a next belief, then the handoff p ← q.
  params      data/pointer-chase-params.json: { n, seed, flag, beta, maxSteps }.
  matricesId  optional id of the node-token matrix in the inspector, so prose can link to it.
-->
<script>
  import { onDestroy } from 'svelte'
  import katex from 'katex'
  import CircleGraph from '../shared/CircleGraph.svelte'
  import { series, fmt } from '../../../bloggie/lib/colors.js'
  import { argmax, onehot } from '../../../bloggie/lib/math.js'
  import {
    letterOf, pointerChaseGraph, transformerTrajectory, transformerProjections,
    energyTrajectory, energyProjection, twoSlotTrajectory,
  } from './pointer-chase.js'

  let { model = 'transformer', params = {}, matricesId = null, medium = 'blog' } = $props() // medium: 'slide' in a deck (bloggie/lib/slide-headings.js)

  const DEFAULTS = { n: 8, seed: 5, flag: 7, beta: 5, maxSteps: 9 }

  // Each model: a trajectory of beliefs over the graph, the weights shown in the inspector, and its text.
  const MODELS = {
    transformer: {
      // t = 1, not 0: frame 0 is the one-hot start, which β does not change.
      initialT: 1,
      trajectory: transformerTrajectory,
      updateDescription: 'It is replaced -- not blended -- each loop by attention over the other nodes.',
      caption:
        'The walker starts, by default, at the node most hops from the flag -- click any node to start it there ' +
        'instead. Each loop it replaces its belief with the next-pointer of whatever node it currently matches. ' +
        "Node opacity is the walker's belief mass; the outlined node is its current best guess. It reaches the " +
        'flag -- the node whose green arrow points back to itself -- and stays there.  Higher beta makes attention more concentrated.',
      weights: (n) => {
        const { query, key, value } = transformerProjections(n)
        const shape = `${2 * n}×${2 * n}`
        return [
          { label: `W_Q (${shape}, keeps id coordinates and zeros the next half):`, matrix: query },
          { label: `W_K (${shape}, identity -- keeps the full node token):`, matrix: key },
          { label: `W_V (${shape}, moves next into id and zeros the next half):`, matrix: value },
        ]
      },
    },
    // One matrix does both jobs: descent on E(x) = |x|²/2 - (1/β) log Σ exp(β xᵀ M g_m) relaxes toward the
    // softmax-weighted average of M g_m. b = 0.5 (not 1) avoids belief leaking through the flag's
    // doubled bucket at weak β (see the tests).
    energy: {
      initialT: 1,
      trajectory: (args) => energyTrajectory({ ...args, a: 1, b: 0.5, eta: 0.5 }),
      updateDescription:
        'It relaxes toward the softmax-weighted average of the same matrix applied to the graph tokens -- a small ' +
        'step each loop, not a replace, because the write is literally the gradient of the match score.',
      caption:
        'The walker starts, by default, at the node most hops from the flag -- click any node to start it there ' +
        'instead. Each loop it takes one gradient-descent step on its own energy, relaxing toward whatever the match ' +
        "score points to. Node opacity is the walker's belief mass. Unlike the transformer, a single slot's descent " +
        'can only ever converge toward the node it already resembles: watch it settle and freeze at the start, never ' +
        'reaching the flag.',
      weights: (n) => {
        const shape = `${2 * n}×${2 * n}`
        const K = energyProjection(n, 1, 0.5)
        return [
          { label: `W_Q (${shape}, no independent value projection -- this is the same matrix as W_K below):`, matrix: K },
          { label: `W_K (${shape}, identical to W_Q -- the write can only ever be built from these two):`, matrix: K },
        ]
      },
      derivation:
        'Whatever $W_Q$ does structurally caps what the write can do, no matter what $W_K$ contributes. So to ' +
        'give the next half any chance of reaching the id half, $W_Q$ has to read it too. Extending both ' +
        'together, symmetrically, is the natural single-matrix design: ' +
        '$W_Q = W_K = \\operatorname{diag}(\\sqrt a\\, I_N,\\, \\sqrt b\\, I_N)$, exactly the matrices above. Then ' +
        '$M := W_Q^\\top W_K = \\operatorname{diag}(a\\, I_N,\\, b\\, I_N)$ -- still block-diagonal because ' +
        "squaring a diagonal matrix can never create a term connecting an input's next coordinates to an " +
        "output's id coordinates. Node $c$'s next-pointer can now influence the score and can be written into " +
        "the walker's own next half, but it can never be written into the id half. Energy minimization " +
        'structurally can only use it as more evidence for whichever node the id half already agrees with.',
    },
    // The same energy with W_Q = W_K = I on a walker [p; q]. Both halves descend together; the handoff
    // p ← q, q ← 0 between loops is the only step that is not descent.
    twoSlot: {
      // Frame 0 is already a relaxed hop, so β acts on it and a click can show it.
      initialT: 0,
      trajectory: twoSlotTrajectory,
      walkerDescription:
        "The walker is [p; q]: p is a belief over the current node, q a belief over the next node, each over the " +
        "graph's vocab (A–H). ",
      updateDescription:
        'Each loop descends one energy in both halves together, so q completes the stored edge that p matches. ' +
        'Copying q into p (and resetting q to zero) starts the next loop.',
      caption:
        'Orange is p, the belief over the current node; blue is q, the belief over the next node. Click a node to put ' +
        'p there. Each loop is 30 joint descent steps on E(p, q), then the handoff p ← q. At low β the current-node ' +
        'match diffuses during descent, so the walk can lose its path.',
      weights: (n) => [
        { label: `W_Q = W_K = I (${2 * n}×${2 * n}); no projection, no separate coupling:`, matrix: energyProjection(n, 1, 1) },
      ],
      walkerLabel: 'Relaxed state this loop (p | q):',
    },
  }

  const m = $derived(MODELS[model])
  const config = $derived({ ...DEFAULTS, ...params })

  let seed = $state(null) // set by shuffle; null uses the params' seed
  let beta = $state(null) // set by the slider; null uses the params' β
  let chosen = $state(null) // a clicked start node; null is the default start
  let t = $state(null) // loop shown; null is the model's first frame
  let playing = $state(false)
  let timer = null

  const b = $derived(beta ?? config.beta)
  const loop = $derived(t ?? m.initialT)
  const graph = $derived(pointerChaseGraph({ n: config.n, seed: seed ?? config.seed, flag: config.flag }))
  // Cutting the cycle at the flag leaves its former successor furthest away: the default start.
  const start = $derived(chosen ?? graph.cycle[graph.flag])
  const frames = $derived(m.trajectory({ ...graph, start, beta: b, steps: config.maxSteps }))
  const frame = $derived(frames[Math.min(loop, frames.length - 1)])
  const best = $derived(argmax(frame.belief))

  const stop = () => {
    clearInterval(timer)
    timer = null
    playing = false
  }
  onDestroy(stop)

  function play() {
    if (playing) return stop()
    playing = true
    if (loop >= config.maxSteps) t = 0
    timer = setInterval(() => {
      if (loop >= config.maxSteps) return stop()
      t = loop + 1
    }, 550)
  }
  const stepBy = (d) => {
    stop()
    t = Math.max(0, Math.min(config.maxSteps, loop + d))
  }
  // Rewind to the first loop, the post's graph and its default start; the reader's β stays.
  const reset = () => {
    stop()
    t = null
    chosen = null
    seed = null
  }
  const shuffle = () => {
    stop()
    t = null
    chosen = null
    seed = Math.floor(Math.random() * 1e6)
  }
  // A click shows the walker on the clicked node (frame 0), not one hop past it.
  const selectStart = (i) => {
    stop()
    t = 0
    chosen = i
  }

  // One row of bars per belief the model exposes; the single-slot models have one.
  const beliefRows = $derived(
    model === 'twoSlot'
      ? [
          { title: 'p -- belief over the current node', values: frame.belief, color: series[2] },
          { title: 'q -- belief over the next node', values: frame.next, color: series[1] },
        ]
      : [{ title: 'walker belief over all possible nodes', values: frame.belief, color: series[2] }]
  )

  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const nodes = (i) => {
    const tags = [i === start && 'start', i === graph.flag && 'flag'].filter(Boolean)
    const suffix = tags.length ? ` (${tags.join(', ')})` : ''
    return {
      fill: series[2],
      fillOpacity: frame.belief[i],
      stroke: i === best ? series[2] : 'none',
      strokeWidth: 2.5,
      // q, when the model has one: a blue outer ring as opaque as q's mass on the node.
      ring: frame.next ? series[1] : null,
      ringOpacity: frame.next ? clamp01(frame.next[i]) : 0,
      ringGap: 10,
      ringWidth: 3,
      title: i === start ? `${letterOf(i)}${suffix} -- click to keep it here` : `click to start the walker at ${letterOf(i)}${suffix}`,
    }
  }

  // Right-align every cell to the widest value, so a mixed matrix (0, 1, √0.5) lines up in a <pre>.
  const rows = (matrix) => {
    const width = Math.max(...matrix.flat().map((v) => String(v).length))
    return matrix.map((row) => row.map((v) => String(v).padStart(width)).join(' ')).join('\n')
  }
  const walkerText = $derived.by(() => {
    const n = graph.n
    const w = frame.walker
    return `${w.slice(0, n).map((x) => fmt(x, 2)).join(' ')} | ${w.slice(n).map((x) => fmt(x, 2)).join(' ')}`
  })
  const tokenMatrix = $derived(rows(Array.from({ length: graph.n }, (_, k) => [...onehot(graph.n, k), ...onehot(graph.n, graph.arrows[k])])))
  const weights = $derived(m.weights(graph.n))

  // Prose with $…$ math, typeset by KaTeX (also on the server).
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const withMath = (text) => text.split(/(\$[^$]+\$)/).map((part) =>
    part.startsWith('$') ? katex.renderToString(part.slice(1, -1), { throwOnError: false }) : escape(part)).join('')
</script>

<figure class="viz pc-figure" data-medium={medium}>
  <div class="controls fig-controls">
    <div class="fig-transport">
      <button class="fig-step" onclick={() => stepBy(-1)} aria-label="step back one loop" title="Step back">‹</button>
      <button class="fig-play" onclick={play} title={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
      <button class="fig-step" onclick={() => stepBy(1)} aria-label="step forward one loop" title="Step forward">›</button>
    </div>
    <button class="fig-icon" onclick={reset} aria-label="reset" title="Reset">↺</button>
    <button class="fig-icon" onclick={shuffle} aria-label="shuffle graph" title="Shuffle graph">⇄</button>
    <label>
      β<span>{fmt(b, 1)}</span>
      <input autocomplete="off" type="range" min="0.5" max="12" step="0.1" value={b} aria-label="attention temperature beta"
        oninput={(e) => { stop(); beta = +e.currentTarget.value }} />
    </label>
    <label>
      t<span>{loop}</span>
      <input autocomplete="off" type="range" min="0" max={config.maxSteps} step="1" value={loop} aria-label="loop iteration"
        oninput={(e) => { stop(); t = +e.currentTarget.value }} />
    </label>
  </div>

  <div class="pc-belief-display">
    {#each beliefRows as row}
      <div>
        <div class="fig-title">{row.title}</div>
        <div class="pc-belief-bars">
          {#each row.values as value, i}
            <div class="pc-bar-col">
              <div class="pc-bar-track">
                <div class="pc-bar" style:height="max(2px, {clamp01(value) * 100}%)" style:background={row.color}></div>
              </div>
              <div class="pc-bar-value">{fmt(value, 2)}</div>
              <div class="pc-bar-label">{letterOf(i)}</div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="viz-plot">
    <CircleGraph {graph} {nodes} onnodeclick={selectStart} size={320} nodeR={15} inset={64} bend={36} loopReach={62} labelSize={11}
      title="Pointer-chase walker at loop {loop}, best guess {letterOf(best)}" />
  </div>

  <div class="readout">
    <div>
      {#if model === 'twoSlot'}
        <span>p at <b>{letterOf(argmax(frame.belief))}</b>, q at <b>{letterOf(argmax(frame.next))}</b>, P(flag) = <b>{fmt(frame.belief[graph.flag], 3)}</b></span>
      {:else}
        <span>walker at <b>{letterOf(best)}</b>, P(flag) = <b>{fmt(frame.belief[graph.flag], 3)}</b></span>
      {/if}
    </div>
  </div>

  <details class="pc-inspect">
    <summary>inspect the weights and encoding</summary>
    <div class="pc-matrices">
      <div class="pc-inspect-intro">
        {m.walkerDescription ?? ('The model predicts a distribution over which node comes next. A walker is ' +
          "that distribution: a belief b over the graph's vocab (A–H), stored in the id half of p = [b; 0] -- " +
          'shown live, as bars, beside the graph. ')}{m.updateDescription}
      </div>
      <div>{m.walkerLabel ?? 'Walker after this loop (id half | next half):'}</div>
      <pre class="pc-walker">{walkerText}</pre>
      <div id={matricesId}>
        Node-token matrix G (one row per node, A–H; columns = id then next, each one-hot over the vocab, from the current graph):
      </div>
      <pre>{tokenMatrix}</pre>
      <div>
        {#each weights as w}
          <div>{w.label}</div>
          <pre>{rows(w.matrix)}</pre>
        {/each}
      </div>
      {#if m.derivation}
        <!-- data-agent-text: the agent download keeps this text (bloggie/scripts/export/agent.js). -->
        <div class="pc-derivation" data-agent-text>{@html withMath(m.derivation)}</div>
      {/if}
    </div>
  </details>

  <figcaption>{m.caption}</figcaption>
</figure>

<style>
  /* The graph on the left, its belief bars, readout and caption beside it, the controls above and the
     inspector below. On a narrow screen the children stack in document order. */
  .pc-figure {
    display: grid;
    grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr auto;
    grid-template-areas:
      'controls controls'
      'plot beliefs'
      'plot readout'
      'plot caption'
      'inspect inspect';
    column-gap: 1.5rem;
  }

  .pc-figure > .controls { grid-area: controls; }
  .pc-figure > .pc-belief-display { grid-area: beliefs; }
  .pc-figure > .viz-plot { grid-area: plot; align-self: center; }
  .pc-figure > .readout { grid-area: readout; margin-top: 0; }
  .pc-figure > .pc-inspect { grid-area: inspect; }
  .pc-figure > figcaption { grid-area: caption; margin-top: 0.5rem; font-size: 0.78rem; }

  @media (max-width: 40rem) {
    .pc-figure {
      display: block;
    }
  }

  /* Condensed belief bars; a bar's height is its share of the track. */
  .pc-belief-display {
    margin-bottom: 0.4rem;
  }

  .pc-belief-bars {
    display: flex;
    align-items: flex-start;
    gap: 0.2rem;
    margin: 0.1rem 0 0.2rem;
  }

  .pc-bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
  }

  .pc-bar-track {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    height: 26px;
  }

  .pc-bar {
    width: 100%;
    max-width: 22px;
    border-radius: 2px 2px 0 0;
    transition: height 120ms ease;
  }

  .pc-bar-value {
    font-size: 0.55rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    margin-top: 0.15rem;
  }

  .pc-bar-label {
    font-size: 0.58rem;
    color: var(--text-muted);
  }

  .pc-matrices pre {
    font-family: var(--mono);
    font-size: 0.68rem;
    line-height: 1.4;
    overflow-x: auto;
    margin: 0.2rem 0 0.7rem;
    color: var(--text-primary);
  }

  .pc-inspect-intro {
    margin-bottom: 0.5rem;
  }

  .pc-derivation {
    margin-top: 0.9rem;
  }

  /* On a demo slide: the graph gets as much room as its belief bars. */
  :global(.slide .demo) .pc-figure {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
</style>
