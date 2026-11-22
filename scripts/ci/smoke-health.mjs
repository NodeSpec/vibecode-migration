#!/usr/bin/env node
// After every deploy, calls GET /api/health on the deployed URL and checks the answer against the
// App-to-pipeline contract: functions. The contract is the schema; this never reads the function's code.
//
// The answer must be 200 JSON with Cache-Control: no-store and exactly
// { status: "ok", deployContext, paymentsMode, branch?, commitRef? }. Production must report
// live payments and every other deploy test payments, so a preview or staging deploy holding a
// live payment key fails loudly. Neither a key nor a stack trace may appear in the body.
//
// Usage: DEPLOY_URL=https://... DEPLOY_ENVIRONMENT="Deploy Preview" node scripts/ci/smoke-health.mjs
import { pathToFileURL } from 'node:url'

const DEPLOY_CONTEXTS = ['production', 'deploy-preview', 'branch-deploy', 'dev']
const PAYMENTS_MODES = ['test', 'live']
const ALLOWED_FIELDS = new Set(['status', 'deployContext', 'paymentsMode', 'branch', 'commitRef'])

const KEY_SHAPED = /^(?:sk|pk|rk)_/i
const STACK_TRACE = /\bat\s+[^\s(]+\s+\([^)]*:\d+:\d+\)|\n\s+at\s/

/** Netlify names the production deploy's GitHub environment "Production"; everything else is not production. */
export const isProduction = (environment) => /^\s*production\b/i.test(environment ?? '')

function* stringValues(value) {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const v of value) yield* stringValues(v)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* stringValues(v)
}

/** Problems with one /api/health answer. Empty means it passes. Never repeats a suspected key. */
export function evaluateHealth({ status, headers = {}, bodyText = '', environment = '' }) {
  if (status !== 200) return [`GET /api/health answered status ${status}, expected 200`]
  const problems = []
  const header = (name) => String(headers[name] ?? headers[name.toLowerCase()] ?? '')

  if (!/application\/json/i.test(header('content-type'))) {
    problems.push(`Content-Type is "${header('content-type')}", expected application/json`)
  }
  if (!/\bno-store\b/i.test(header('cache-control'))) {
    problems.push(`Cache-Control is "${header('cache-control')}", expected no-store`)
  }

  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    return [...problems, 'the body is not valid JSON']
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [...problems, 'the body is not a JSON object']
  }

  const values = [...stringValues(body)]
  if (values.some((v) => KEY_SHAPED.test(v.trim()))) {
    problems.push('the body contains a value shaped like a key (not repeated here)')
  }
  if (values.some((v) => STACK_TRACE.test(v))) problems.push('the body contains a stack trace')

  for (const field of ['status', 'deployContext', 'paymentsMode']) {
    if (!(field in body)) problems.push(`the body has no "${field}" field`)
  }
  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) problems.push(`the body has an unexpected field "${field}"`)
  }
  if ('status' in body && body.status !== 'ok') problems.push(`status is ${JSON.stringify(body.status)}, expected "ok"`)
  if ('deployContext' in body && !DEPLOY_CONTEXTS.includes(body.deployContext)) {
    problems.push(`deployContext is ${JSON.stringify(body.deployContext)}, expected one of ${DEPLOY_CONTEXTS.join(', ')}`)
  }
  if ('paymentsMode' in body && !PAYMENTS_MODES.includes(body.paymentsMode)) {
    problems.push(`paymentsMode is ${JSON.stringify(body.paymentsMode)}, expected test or live`)
  }

  const production = isProduction(environment)
  const label = environment || 'this deploy'
  const wantMode = production ? 'live' : 'test'
  if (PAYMENTS_MODES.includes(body.paymentsMode) && body.paymentsMode !== wantMode) {
    problems.push(`${label}: paymentsMode is "${body.paymentsMode}", expected "${wantMode}" for this environment`)
  }
  if (DEPLOY_CONTEXTS.includes(body.deployContext)) {
    if (production && body.deployContext !== 'production') {
      problems.push(`${label}: deployContext is "${body.deployContext}", expected "production"`)
    }
    if (!production && body.deployContext === 'production') {
      problems.push(`${label}: deployContext is "production" on a deploy that is not production`)
    }
  }
  return problems
}

async function fetchHealth(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) })
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    bodyText: await response.text(),
  }
}

async function main() {
  const base = process.env.DEPLOY_URL
  const environment = process.env.DEPLOY_ENVIRONMENT ?? ''
  if (!base || !/^https:\/\//.test(base)) throw new Error('DEPLOY_URL must be the https URL of the deploy')
  const url = `${base.replace(/\/+$/, '')}/api/health`
  // The first runs record the environment name GitHub receives, so the production mapping can be checked.
  console.log(`smoke-health: environment "${environment}" (${isProduction(environment) ? 'production' : 'not production'}), GET ${url}`)

  let answer
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      answer = await fetchHealth(url)
      break
    } catch (error) {
      if (attempt === 3) throw new Error(`could not reach ${url}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
  const problems = evaluateHealth({ ...answer, environment })
  if (problems.length > 0) {
    console.error(`smoke-health: FAIL for "${environment}"`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`smoke-health: OK for "${environment}"`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`smoke-health: FAIL (${error.message})`)
    process.exit(1)
  })
}
