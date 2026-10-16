#!/usr/bin/env node
// REQ-008: a variable given a browser-exposed prefix (VITE_ in Vite, NEXT_PUBLIC_ in Next.js)
// is copied into the public site, so none may be named like a secret (KEY, SECRET, TOKEN,
// PASSWORD). Public-by-design values, such as a Supabase anon key, are listed with a reason in
// .github/public-env-allowlist.json, which only the code owner can change.
//
// Usage: node scripts/ci/check-public-env.mjs [--root <dir>]
// Prints names and locations, never values. Exit 0 = clean, 1 = a violation or a bad allowlist.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BROWSER_NAME = /\b(?:VITE|NEXT_PUBLIC)_[A-Za-z0-9_]+/gi
const SECRET_NAME = /^(?:VITE|NEXT_PUBLIC)_.*(?:KEY|SECRET|TOKEN|PASSWORD)/i

const ALLOWLIST = '.github/public-env-allowlist.json'
const SCANNED_DIRECTORIES = ['src', 'netlify']
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist'])
const MAX_BYTES = 1024 * 1024

/** Root files that can declare a variable: netlify.toml, vite.config.*, and every .env* file. */
function rootFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name === 'netlify.toml' || e.name.startsWith('vite.config.') || e.name.startsWith('.env')))
    .map((e) => join(root, e.name))
}

function* walk(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

function readText(path) {
  if (statSync(path).size > MAX_BYTES) return null
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 8000).includes(0)) return null
  return bytes.toString('utf8')
}

/** The allowlist as a set of upper-cased names, plus any problems with the file itself. */
function loadAllowlist(root) {
  const path = join(root, ALLOWLIST)
  if (!existsSync(path)) return { names: new Set(), errors: [`${ALLOWLIST} is missing: create it as []`] }
  let entries
  try {
    entries = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { names: new Set(), errors: [`${ALLOWLIST} is not valid JSON`] }
  }
  if (!Array.isArray(entries)) {
    return { names: new Set(), errors: [`${ALLOWLIST} must be a JSON list of { "name", "reason" } entries`] }
  }
  const names = new Set()
  const errors = []
  entries.forEach((entry, i) => {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    if (!name) errors.push(`${ALLOWLIST} entry ${i + 1} has no name`)
    else if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(`${ALLOWLIST} entry "${name}" has no reason: say why the value is public by design`)
    } else names.add(name.toUpperCase())
  })
  return { names, errors }
}

export function scan(root) {
  const { names: allowed, errors } = loadAllowlist(root)
  const violations = []
  const files = [...rootFiles(root), ...SCANNED_DIRECTORIES.flatMap((d) => [...walk(join(root, d))])]
  for (const path of files) {
    const text = readText(path)
    if (text === null) continue
    text.split('\n').forEach((line, i) => {
      for (const [name] of line.matchAll(BROWSER_NAME)) {
        if (SECRET_NAME.test(name) && !allowed.has(name.toUpperCase())) {
          violations.push({ file: relative(root, path), line: i + 1, name })
        }
      }
    })
  }
  return { violations, errors, filesScanned: files.length, allowlisted: allowed.size }
}

function main() {
  const flag = process.argv.indexOf('--root')
  const root = resolve(flag === -1 ? process.cwd() : process.argv[flag + 1] ?? '')
  const { violations, errors, filesScanned, allowlisted } = scan(root)
  for (const message of errors) console.error(`check-public-env: ${message}`)
  for (const v of violations) {
    console.error(
      `check-public-env: ${v.file}:${v.line} ${v.name} is named like a secret but is exposed to the browser. ` +
        'Move the call into a function under netlify/functions and rotate the key; do not rename the variable. ' +
        `If the value is public by design, list it with a reason in ${ALLOWLIST}.`,
    )
  }
  if (errors.length > 0 || violations.length > 0) process.exit(1)
  console.log(`check-public-env: OK (${filesScanned} files scanned, ${allowlisted} allowlisted names)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`check-public-env: unexpected error: ${error.message}`)
    process.exit(1)
  }
}
