#!/usr/bin/env node
// `npm create bloggie <folder> [-- options]` runs this package, create-bloggie, which has no dependencies. It runs the
// latest Bloggie's own create script (scripts/create.js, `npx bloggie`) with the same arguments, so the starter blog
// is always the latest one, and this package needs a new version only when this file changes.
import { spawnSync } from 'node:child_process'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const { status, error } = spawnSync(npx, ['--yes', 'bloggie@latest', ...process.argv.slice(2)], { stdio: 'inherit', shell: process.platform === 'win32' })
if (error) throw error
process.exit(status ?? 1)
