#!/usr/bin/env node
// Runs after `npm run build` (the `postbuild` script). Netlify's build variables BRANCH and
// COMMIT_REF do not exist when a function runs, so they are written into a file the function
// bundles. Each deploy therefore carries its own, and a rolled-back deploy reports its own commit.
//
// Usage: node scripts/write-build-info.mjs [--out <file>]
// Outside a Netlify build both fields are "local".
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const flag = process.argv.indexOf('--out')
const out =
  flag === -1
    ? fileURLToPath(new URL('../netlify/functions/_lib/build-info.json', import.meta.url))
    : resolve(process.argv[flag + 1] ?? '')

// Only these two values are read from the environment; nothing else is ever written.
const info = {
  branch: process.env.BRANCH || 'local',
  commitRef: (process.env.COMMIT_REF || 'local').slice(0, 7),
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`)
console.log(`write-build-info: ${info.branch} @ ${info.commitRef}`)
