<!--
  A walker on a graph of eight nodes, moved by one attention head applied in a loop (attention-walk.js).

  <AttentionWalk client:visible params={{ seed: 5 }} />

  params  optional { n, seed, flag, beta, maxSteps }; the defaults draw the example post's graph.
-->
<script>
  import { onDestroy } from 'svelte'
  import CircleGraph from '../shared/CircleGraph.svelte'
  import { series, fmt } from 'bloggie/lib/colors.js'
  import { argmax } from 'bloggie/lib/math.js'
  import { letterOf, trajectory, walkGraph } from './attention-walk.js'

  let { params = {}, medium = 'blog' } = $props() // medium: 'slide' in a deck (bloggie/lib/slide-headings.js)

  const DEFAULTS = { n: 8, seed: 5, flag: 7, beta: 5, maxSteps: 9 }
  const config = $derived({ ...DEFAULTS, ...params })

  let seed = $state(null) // set by shuffle; null uses the params' seed
  let beta = $state(null) // set by the slider; null uses the params' β
  let chosen = $state(null) // a clicked start node; null is the default start
  let loop = $state(0) // the loop shown; 0 is the start
  let playing = $state(false)
  let timer = null

  const b = $derived(beta ?? config.beta)
  const graph = $derived(walkGraph({ n: config.n, seed: seed ?? config.seed, flag: config.flag }))
  // Cutting the cycle at the flag leaves its former successor furthest away: the default start.
  const start = $derived(chosen ?? graph.cycle[graph.flag])
  const frames = $derived(trajectory({ ...graph, start, beta: b, steps: config.maxSteps }))
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
    if (loop >= config.maxSteps) loop = 0
    timer = setInterval(() => {
      if (loop >= config.maxSteps) return stop()
      loop += 1
    }, 550)
  }
  const stepBy = (d) => {
    stop()
    loop = Math.max(0, Math.min(config.maxSteps, loop + d))
  }
  // Back to loop 0, the default graph and its default start; the reader's β stays.
  const reset = () => {
    stop()
    loop = 0
    chosen = null
    seed = null
  }
  const shuffle = () => {
    reset()
    seed = Math.floor(Math.random() * 1e6)
  }
  const selectStart = (i) => {
    stop()
    loop = 0
    chosen = i
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const nodes = (i) => {
    const tags = [i === start && 'start', i === graph.flag && 'flag'].filter(Boolean)
    const suffix = tags.length ? ` (${tags.join(', ')})` : ''
    return {
      fill: series[2],
      fillOpacity: frame.belief[i],
      stroke: i === best ? series[2] : 'none',
      strokeWidth: 2.5,
      title: i === start ? `${letterOf(i)}${suffix} -- click to keep it here` : `click to start the walker at ${letterOf(i)}${suffix}`,
    }
  }
</script>

<figure class="viz aw-figure" data-medium={medium}>
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
        oninput={(e) => { stop(); loop = +e.currentTarget.value }} />
    </label>
  </div>

  <div class="aw-beliefs">
    <div class="fig-title">walker belief over all possible nodes</div>
    <div class="aw-bars">
      {#each frame.belief as value, i}
        <div class="aw-bar-col">
          <div class="aw-bar-track">
            <div class="aw-bar" style:height="max(2px, {clamp01(value) * 100}%)" style:background={series[2]}></div>
          </div>
          <div class="aw-bar-value">{fmt(value, 2)}</div>
          <div class="aw-bar-label">{letterOf(i)}</div>
        </div>
      {/each}
    </div>
  </div>

  <div class="viz-plot">
    <CircleGraph {graph} {nodes} onnodeclick={selectStart} size={320} nodeR={15} inset={64} bend={36} loopReach={62} labelSize={11}
      title="Attention walker at loop {loop}, best guess {letterOf(best)}" />
  </div>

  <div class="readout">
    <span>walker at <b>{letterOf(best)}</b>, P(flag) = <b>{fmt(frame.belief[graph.flag], 3)}</b></span>
  </div>

  <figcaption>
    The walker starts, by default, at the node most hops from the flag -- click any node to start it there instead.
    Each loop it replaces its belief with the next-pointer of whatever node it currently matches. Node opacity is the
    walker's belief mass; the outlined node is its current best guess. It reaches the flag -- the node whose green
    arrow points back to itself -- and stays there. Higher beta makes attention more concentrated.
  </figcaption>
</figure>

<style>
  /* The graph on the left; its belief bars, readout and caption beside it; the controls above. On a narrow screen
     the children stack in document order. */
  .aw-figure {
    display: grid;
    grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr;
    grid-template-areas:
      'controls controls'
      'plot beliefs'
      'plot readout'
      'plot caption';
    column-gap: 1.5rem;
  }

  .aw-figure > .controls { grid-area: controls; }
  .aw-figure > .aw-beliefs { grid-area: beliefs; margin-bottom: 0.4rem; }
  .aw-figure > .viz-plot { grid-area: plot; align-self: center; }
  .aw-figure > .readout { grid-area: readout; margin-top: 0; }
  .aw-figure > figcaption { grid-area: caption; margin-top: 0.5rem; font-size: 0.78rem; }

  @media (max-width: 40rem) {
    .aw-figure { display: block; }
  }

  /* A bar's height is its share of the track. */
  .aw-bars {
    display: flex;
    align-items: flex-start;
    gap: 0.2rem;
    margin: 0.1rem 0 0.2rem;
  }

  .aw-bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1 1 0;
  }

  .aw-bar-track {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: 100%;
    height: 26px;
  }

  .aw-bar {
    width: 100%;
    max-width: 22px;
    border-radius: 2px 2px 0 0;
    transition: height 120ms ease;
  }

  .aw-bar-value {
    font-size: 0.55rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    margin-top: 0.15rem;
  }

  .aw-bar-label {
    font-size: 0.58rem;
    color: var(--text-muted);
  }

  /* On a demo slide: the graph gets as much room as its belief bars. */
  :global(.slide .demo) .aw-figure {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
</style>
