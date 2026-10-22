<!--
  The pointer-chase graph drawn as nodes on a circle, shared by the pointer-chase, unrolling and
  inpainting figures. The figure decides every style; this component only draws.

  <CircleGraph {graph} nodes={(i) => ({ ... })} hops={[...]} onnodeclick={(i) => ...} />

  graph        { n, arrows, flag }: node i points to arrows[i]; the flag points to itself.
  nodes(i)     style of node i: { fill, fillOpacity, stroke, strokeWidth, ring, ringOpacity, title }.
               `ring` draws a second circle outside the node (the next-node belief).
  edgeOpacity(i) how visible node i's stored edge is (0 hides it under a hop that covers it).
  hops         highlighted hops over the stored edges: { from, to, color, width, opacity, title }.
               A hop that is a stored edge follows the edge's curve; any other hop is straight.
  size, nodeR, inset, bend, loopReach, labelSize: geometry, in viewBox units.
-->
<script>
  import { letterOf } from '../pointer-chase/pointer-chase.js'
  import { ink, series } from '../../../bloggie/lib/colors.js'

  let {
    graph,
    nodes = () => ({}),
    edgeOpacity = () => 1,
    hops = [],
    onnodeclick = null,
    size = 320,
    nodeR = 15,
    inset = 54,
    bend = 36,
    loopReach = 62,
    labelSize = 11,
    edgeWidth = 1.6,
    title = '',
  } = $props()

  const uid = $props.id()
  // Arrowhead markers, one per color a hop may use (ink.muted, series[3], series[2], series[1]).
  const colors = { muted: ink.muted, flag: series[3], p: series[2], q: series[1] }

  const c = $derived(size / 2)
  const r = $derived(size / 2 - inset)
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / graph.n
  const pos = $derived(Array.from({ length: graph.n }, (_, i) => [c + r * Math.cos(angle(i)), c + r * Math.sin(angle(i))]))

  // A quadratic curve from node i to node j, bent away from the center, trimmed at both ends so
  // neither the line nor its arrowhead runs under a node.
  function edgePath(i, j) {
    const [x1, y1] = pos[i]
    const [x2, y2] = pos[j]
    const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2]
    const length = Math.hypot(x2 - x1, y2 - y1)
    const normal = [-(y2 - y1) / length, (x2 - x1) / length]
    const inward = normal[0] * (c - mx) + normal[1] * (c - my)
    const b = Math.min(bend, length * 0.18) * (inward < -1e-6 ? -1 : 1)
    const [bx, by] = [mx + normal[0] * b, my + normal[1] * b]
    const pad = nodeR + 3
    const trim = ([ax, ay], [tx, ty]) => {
      const d = Math.hypot(tx - ax, ty - ay) || 1
      return [ax + ((tx - ax) / d) * pad, ay + ((ty - ay) / d) * pad]
    }
    const [sx, sy] = trim([x1, y1], [bx, by])
    const [ex, ey] = trim([x2, y2], [bx, by])
    return `M ${sx},${sy} Q ${bx},${by} ${ex},${ey}`
  }

  // A straight hop between two nodes that are not a stored edge.
  function straightPath(i, j) {
    const [[xa, ya], [xc, yc]] = [pos[i], pos[j]]
    const len = Math.hypot(xc - xa, yc - ya)
    const [ux, uy] = [(xc - xa) / len, (yc - ya) / len]
    const pad = nodeR + 3
    return `M ${xa + ux * pad},${ya + uy * pad} L ${xc - ux * pad},${yc - uy * pad}`
  }

  // The self-loop on node i, leaving and returning at symmetric points on its rim.
  function loopPath(i) {
    const [nx, ny] = pos[i]
    const t = angle(i)
    const at = (radius, theta) => [nx + radius * Math.cos(theta), ny + radius * Math.sin(theta)]
    const [p1, p2, c1, c2] = [at(nodeR + 3, t - 0.85), at(nodeR + 3, t + 0.85), at(loopReach, t - 0.85), at(loopReach, t + 0.85)]
    return `M ${p1[0]},${p1[1]} C ${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }

  const hopPath = (h) => (h.from === h.to ? loopPath(h.from) : graph.arrows[h.from] === h.to ? edgePath(h.from, h.to) : straightPath(h.from, h.to))
  const markerFor = (color) => Object.keys(colors).find((key) => colors[key] === color) ?? 'muted'
</script>

<svg viewBox="0 0 {size} {size}" role="img" aria-label={title}>
  <defs>
    {#each Object.entries(colors) as [key, color]}
      <marker id="{uid}-{key}" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
        <path d="M0,0 L8,4 L0,8 z" style:fill={color} />
      </marker>
    {/each}
  </defs>

  {#each pos as _, i}
    {@const opacity = edgeOpacity(i)}
    {#if opacity > 0.001}
      {#if i === graph.flag}
        <path d={loopPath(i)} class="edge" style:stroke={colors.flag} style:stroke-width={edgeWidth + 0.2} style:opacity={opacity} marker-end="url(#{uid}-flag)" />
      {:else}
        <path d={edgePath(i, graph.arrows[i])} class="edge" style:stroke={colors.muted} style:stroke-width={edgeWidth} style:opacity={0.85 * opacity} marker-end="url(#{uid}-muted)" />
      {/if}
    {/if}
  {/each}

  {#each hops as hop}
    {#if hop.opacity > 0.001}
      <path d={hopPath(hop)} class="edge" style:stroke={hop.color} style:stroke-width={hop.width ?? 2.4} style:opacity={hop.opacity} marker-end="url(#{uid}-{markerFor(hop.color)})">
        {#if hop.title}<title>{hop.title}</title>{/if}
      </path>
    {/if}
  {/each}

  {#each pos as [x, y], i}
    {@const s = nodes(i)}
    {@const clickable = !!onnodeclick && s.clickable !== false}
    <!-- A clickable node is a button for the keyboard too: Tab reaches it, Enter or Space presses it. -->
    <g class:clickable role={clickable ? 'button' : undefined} tabindex={clickable ? 0 : undefined}
      aria-label={clickable ? (s.title ?? letterOf(i)) : undefined}
      onclick={() => clickable && onnodeclick(i)}
      onkeydown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onnodeclick(i) } }}>
      <circle cx={x} cy={y} r={nodeR + 6} fill="transparent" />
      <circle cx={x} cy={y} r={nodeR} style:fill={ink.surface} style:stroke={ink.axis} style:stroke-width="1.3" />
      {#if s.fill && (s.fillOpacity ?? 1) > 0.001}
        <circle cx={x} cy={y} r={nodeR} style:fill={s.fill} style:fill-opacity={s.fillOpacity ?? 1} style:stroke={s.stroke ?? 'none'} style:stroke-width={s.strokeWidth ?? 2.2} style:stroke-opacity={s.strokeOpacity ?? 1} />
      {:else if s.stroke}
        <circle cx={x} cy={y} r={nodeR} style:fill="none" style:stroke={s.stroke} style:stroke-width={s.strokeWidth ?? 2.2} style:stroke-opacity={s.strokeOpacity ?? 1} />
      {/if}
      {#if s.ring && (s.ringOpacity ?? 1) > 0.005}
        <circle cx={x} cy={y} r={nodeR + (s.ringGap ?? 7)} style:fill="none" style:stroke={s.ring} style:stroke-width={s.ringWidth ?? 2.8} style:stroke-opacity={Math.min(1, s.ringOpacity ?? 1)} />
      {/if}
      <text x={x} y={y + labelSize * 0.36} text-anchor="middle" class="label" style:font-size="{labelSize}px">{letterOf(i)}</text>
      {#if s.title}<title>{s.title}</title>{/if}
    </g>
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .edge {
    fill: none;
  }
  .label {
    fill: var(--text-primary);
    font-family: var(--sans);
    font-weight: 600;
    pointer-events: none;
  }
  .clickable {
    cursor: pointer;
    outline: none;
  }
  /* The focus ring of a keyboard-focused node: its rim, in the page's link color. !important
     because the rim's stroke is an inline style. */
  .clickable:focus-visible circle:nth-of-type(2) {
    stroke: var(--series-1) !important;
    stroke-width: 3px !important;
  }
</style>
