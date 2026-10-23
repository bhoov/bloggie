#!/usr/bin/env node
// `npm create bloggie <folder> [-- options]` runs this package, create-bloggie, for people who type the usual npm
// command. The documented command is `npx bloggie <folder> [options]`, which needs no `--` and one download less. This
// package has no dependencies: it runs the latest Bloggie's own create script (scripts/create.js) with the same
// arguments, so the starter blog is always the latest one, and it needs a new version only when this file changes.
import { spawnSync } from 'node:child_process'

// --package names Bloggie explicitly: npm passes the outer `npm exec`'s package to this one through the environment.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const { status, error } = spawnSync(npx, ['--yes', '--package=bloggie@latest', 'bloggie', ...process.argv.slice(2)], { stdio: 'inherit', shell: process.platform === 'win32' })
if (error) throw error
process.exit(status ?? 1)
