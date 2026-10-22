// Theme colors as CSS variables (defined in bloggie/styles/site.css for light and dark mode).
// Use them in SVG styles so a figure follows the reader's color scheme with no JavaScript.
export const ink = {
  primary: 'var(--text-primary)',
  secondary: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  grid: 'var(--grid)',
  axis: 'var(--axis)',
  surface: 'var(--surface-1)',
}

// series[1] blue, series[2] orange, series[3] green, series[4] yellow (the reference palette's first four slots).
export const series = {
  1: 'var(--series-1)',
  2: 'var(--series-2)',
  3: 'var(--series-3)',
  4: 'var(--series-4)',
}

// Numbers for readouts: fixed decimals, and a true minus sign.
export const fmt = (value, digits = 2) => value.toFixed(digits).replace('-', '−')
