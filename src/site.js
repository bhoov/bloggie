// Site-wide constants used by the layouts and the home page.
export const site = {
  title: 'My blog',
  // The deployed site's address, for a host other than GitHub Pages; leave it blank, and the deploy workflow
  // gives the GitHub Pages address (bloggie/lib/site-url.js).
  url: '',
  author: 'Your Name',
  description: 'Interactive essays by Your Name.',
  lede: 'Interactive essays with live figures, and a talk deck for each.',
}

// "18 September 2026" and "2026-09-18" for a front-matter date.
export const longDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
export const isoDate = (date) => new Date(date).toISOString().slice(0, 10)
