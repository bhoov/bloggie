// The address that a downloaded post links back to and a heading's # copies: `url` in src/site.js when the blog sets
// one (a custom host), else SITE_URL, which the deploy workflow sets to the GitHub Pages address when it builds, else
// the dev server's. Build time only.
import { site } from '../../src/site.js'

// GitHub reports a custom domain's Pages address as http://, though Pages serves it over HTTPS.
const pages = process.env.SITE_URL?.replace(/^http:\/\//, 'https://')
const url = site.url || pages || 'http://localhost:4321/'
export const siteUrl = url.endsWith('/') ? url : `${url}/`
