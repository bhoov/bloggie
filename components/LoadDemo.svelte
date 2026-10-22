<!--
  The cover of a demo that needs seconds of work or large data before it can run. Until the reader presses its one
  large "Load demo" button, the demo's first frame shows blurred under it, and the demo's controls are inert.
  The figure keeps its caption outside, so the reader can read what the demo is before loading it.

  <LoadDemo {loaded} onload={load} disabled={!mounted} note="About 15 s of computing, in the background">
    …the figure's controls and panels…
  </LoadDemo>
-->
<script>
  let { loaded, onload, disabled = false, note = '', children } = $props()
  const noteId = $props.id()
</script>

<div class="load-demo">
  <div class="load-demo-content" inert={!loaded}>{@render children()}</div>
  {#if !loaded}
    <div class="load-demo-cover">
      <button type="button" class="load-demo-button" onclick={onload} {disabled} aria-label="load demo" aria-describedby={note ? noteId : undefined}>Load demo</button>
      {#if note}<p class="load-demo-note" id={noteId}>{note}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .load-demo {
    position: relative;
  }
  .load-demo-cover {
    position: absolute;
    inset: -0.35rem;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--surface-1) 60%, transparent);
    /* Unprefixed only: the build adds -webkit- for Safari, and given both it keeps only that one, which Chrome ignores. */
    backdrop-filter: blur(8px);
  }
  .load-demo-button {
    font: 650 1.25rem/1 var(--sans);
    color: #fff;
    background: var(--series-1);
    border: 0;
    border-radius: 8px;
    padding: 0.9rem 2rem;
    cursor: pointer;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--text-primary) 18%, transparent);
    transition: background 0.15s, box-shadow 0.15s;
  }
  .load-demo-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--series-1) 85%, #000);
  }
  .load-demo-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--series-1) 35%, transparent);
  }
  .load-demo-button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .load-demo-note {
    margin: 0;
    font: 0.85rem/1.35 var(--sans);
    color: var(--text-secondary);
    text-align: center;
  }
</style>
