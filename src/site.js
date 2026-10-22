// Site-wide constants used by the layouts and the home page.
export const site = {
  title: 'My blog',
  // The deployed site. A downloaded copy of a post links back here (bloggie/scripts/export/common.js), and a heading's
  // # copies a link here.
  url: 'https://example.github.io/my-blog/',
  author: 'Your Name',
  description: 'Interactive essays by Your Name.',
  lede: 'Interactive essays with live figures, and a talk deck for each.',
}

// "18 September 2026" and "2026-09-18" for a front-matter date.
export const longDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
export const isoDate = (date) => new Date(date).toISOString().slice(0, 10)
