import { join } from 'node:path'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { fixturesDir, readText, repoRoot } from './helpers.ts'

type Table = Record<string, unknown>

const table = (value: unknown): Table =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Table) : {}

const load = (path: string) => parse(readText(path)) as Table
const real = () => load(join(repoRoot, 'netlify.toml'))
const fixture = (name: string) => load(join(fixturesDir, name))
const nvmrc = () => readText(join(repoRoot, '.nvmrc')).trim()

/** REQ-013 AC1: how every deploy context builds, and how /api/* and the SPA fallback are routed. */
function checkBuildSettings(toml: Table, node: string): string[] {
  const problems: string[] = []
  const build = table(toml.build)
  if (typeof build.command !== 'string' || !/^npm ci\b/.test(build.command)) {
    problems.push(`build.command is ${JSON.stringify(build.command)}, expected it to start with "npm ci" so installs come from the lockfile`)
  }
  if (build.publish !== 'dist') problems.push(`build.publish is ${JSON.stringify(build.publish)}, expected "dist"`)
  if (build.functions !== 'netlify/functions') {
    problems.push(`build.functions is ${JSON.stringify(build.functions)}, expected "netlify/functions"`)
  }
  const version = table(build.environment).NODE_VERSION
  if (version !== node) problems.push(`NODE_VERSION is ${JSON.stringify(version)}, expected "${node}" to match .nvmrc`)

  const redirects = (Array.isArray(toml.redirects) ? toml.redirects : []).map(table)
  const api = redirects.findIndex((r) => r.from === '/api/*')
  const last = redirects.length - 1
  if (api === -1) problems.push('there is no [[redirects]] rule for /api/*')
  else if (redirects[api].to !== '/.netlify/functions/:splat' || redirects[api].status !== 200) {
    problems.push('the /api/* redirect must go to /.netlify/functions/:splat with status 200')
  }
  if (last < 0 || redirects[last].from !== '/*' || redirects[last].to !== '/index.html' || redirects[last].status !== 200) {
    problems.push('the last [[redirects]] rule must be the SPA fallback: /* to /index.html with status 200')
  }
  const fallback = redirects.findIndex((r) => r.from === '/*')
  if (api !== -1 && fallback !== -1 && fallback < api) {
    problems.push('the /api/* rule must come before the SPA fallback, or /api/* never reaches the functions')
  }
  return problems
}

const SECRET_KEY_NAME = /KEY|SECRET|TOKEN|PASSWORD/i
// Patterns for credentials, built from parts so this file never contains a complete key-like literal.
const CREDENTIAL_VALUE = [/sk_(?:live|test)_/, /:\/\/[^/\s:@]+:[^/\s@]+@/, /\bAKIA/]

function* environments(toml: Table): Generator<[string, Table]> {
  const build = table(toml.build)
  yield ['[build.environment]', table(build.environment)]
  for (const [name, ctx] of Object.entries(table(toml.context))) {
    yield [`[context.${name}.environment]`, table(table(ctx).environment)]
  }
}

function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const v of value) yield* strings(v)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v)
}

/** REQ-009 AC2: netlify.toml holds no secret values; the values live only in the Netlify UI. */
function checkNoSecrets(toml: Table): string[] {
  const problems: string[] = []
  for (const [where, env] of environments(toml)) {
    for (const [key, value] of Object.entries(env)) {
      if (SECRET_KEY_NAME.test(key)) problems.push(`${where} sets ${key}, a secret-named key: keep it in the Netlify UI`)
      if (key === 'SECRETS_SCAN_ENABLED' && String(value).toLowerCase() === 'false') {
        problems.push(`${where} turns Netlify secret scanning off`)
      }
    }
  }
  for (const text of strings(toml)) {
    if (CREDENTIAL_VALUE.some((pattern) => pattern.test(text))) problems.push('a value in netlify.toml looks like a credential (not repeated here)')
  }
  return problems
}

describe('netlify.toml build settings (REQ-013 AC1)', () => {
  it('installs from the lockfile, publishes dist, bundles netlify/functions and pins Node.js', () => {
    expect(checkBuildSettings(real(), nvmrc())).toEqual([])
  })

  it('routes /api/* to the functions before the SPA fallback to /index.html', () => {
    const redirects = (real().redirects as Table[]).map((r) => `${r.from} -> ${r.to} (${r.status})`)
    expect(redirects).toEqual(['/api/* -> /.netlify/functions/:splat (200)', '/* -> /index.html (200)'])
  })

  it('fails an install that skips the lockfile, naming the command', () => {
    expect(checkBuildSettings(fixture('netlify.npm-install.toml'), '22').join('\n')).toMatch(/build\.command.*npm install.*npm ci/)
  })

  it('fails an SPA fallback listed before the /api/* rule', () => {
    const problems = checkBuildSettings(fixture('netlify.fallback-first.toml'), '22').join('\n')
    expect(problems).toMatch(/SPA fallback/)
    expect(problems).toMatch(/\/api\/\* rule must come before/)
  })

  it('fails a Node.js version that differs from .nvmrc', () => {
    const toml = parse('[build]\ncommand = "npm ci && npm run build"\npublish = "dist"\nfunctions = "netlify/functions"\n[build.environment]\nNODE_VERSION = "20"\n') as Table
    expect(checkBuildSettings(toml, '22').join('\n')).toMatch(/NODE_VERSION.*"20".*"22"/)
  })
})

describe('netlify.toml holds no secret values (REQ-009 AC2)', () => {
  it('has no secret-named key and no value shaped like a credential', () => {
    expect(checkNoSecrets(real())).toEqual([])
  })

  it('fails a secret-named key with a value in a deploy context, naming the key', () => {
    const problems = checkNoSecrets(fixture('netlify.leaky.toml')).join('\n')
    expect(problems).toMatch(/\[context\.deploy-preview\.environment\] sets PAYMENT_SECRET_KEY/)
    expect(problems).toMatch(/looks like a credential/)
  })

  it.each([
    ['a live-key prefix', 'EXAMPLE_VALUE', ['sk', 'live', 'abc'].join('_')],
    ['a connection string with a password', 'DATABASE', 'postgres://user:hunter2@db.example.com/app'],
    ['an AWS access key id prefix', 'ACCESS', ['AK', 'IA'].join('') + 'EXAMPLE'],
  ])('fails %s even under an innocent key name', (_label, key, value) => {
    const toml = parse(`[build.environment]\n${key} = "${value}"\n`) as Table
    expect(checkNoSecrets(toml).join('\n')).toMatch(/looks like a credential/)
    expect(checkNoSecrets(toml).join('\n')).not.toContain(value)
  })

  it('fails secret scanning switched off', () => {
    const toml = parse('[build.environment]\nSECRETS_SCAN_ENABLED = "false"\n') as Table
    expect(checkNoSecrets(toml).join('\n')).toMatch(/turns Netlify secret scanning off/)
  })

  it('allows public build settings', () => {
    const toml = parse('[build.environment]\nNODE_VERSION = "22"\n[context.production.environment]\nVITE_APP_NAME = "Split the bill"\n') as Table
    expect(checkNoSecrets(toml)).toEqual([])
  })
})
