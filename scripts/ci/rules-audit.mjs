#!/usr/bin/env node
// Compares the rules GitHub actually enforces on staging and main with
// .github/rulesets/staging.json and main.json, and reports CODEOWNERS errors.
//
// It fails closed: an API error, an empty rule list or any mismatch is a failure, never a pass.
// It reads only (GET) with the workflow's own read-only GITHUB_TOKEN, so it needs no extra secret.
// It runs weekly and by hand, right after a ruleset is applied: on a pull request the live rules
// still differ from a changed ruleset file, so it would always fail there.
//
// Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/ci/rules-audit.mjs
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const API = 'https://api.github.com'
const API_VERSION = '2026-03-10'
const BRANCHES = ['staging', 'main']

const show = (value) => (value === undefined ? 'missing' : JSON.stringify(value))
const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort())
    : JSON.stringify(a) === JSON.stringify(b)

function compareChecks(branch, want, have) {
  const problems = []
  const contexts = (rules) =>
    new Set(rules.flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context)))
  const wanted = contexts([want])
  const live = contexts(have)
  for (const context of wanted) {
    if (!live.has(context)) problems.push(`${branch}: required check "${context}" is not required on GitHub`)
  }
  for (const context of live) {
    if (!wanted.has(context)) {
      problems.push(`${branch}: GitHub requires check "${context}", which .github/rulesets/${branch}.json does not list`)
    }
  }
  const strict = want.parameters?.strict_required_status_checks_policy
  if (strict !== undefined) {
    for (const rule of have) {
      const liveStrict = rule.parameters?.strict_required_status_checks_policy
      if (liveStrict !== strict) {
        problems.push(`${branch}: required_status_checks.strict_required_status_checks_policy is ${show(liveStrict)}, expected ${show(strict)}`)
      }
    }
  }
  return problems
}

/** Problems found comparing one branch's live rules with its ruleset file. Empty means a match. */
export function compareRules(branch, expected, actual) {
  if (!Array.isArray(actual)) return [`${branch}: GitHub answered with something that is not a list of rules`]
  if (actual.length === 0) {
    return [`${branch}: GitHub reports no active rules for this branch (is the ruleset applied, with enforcement active?)`]
  }
  const problems = []
  const wantedRules = expected.rules ?? []
  const wantedTypes = new Set(wantedRules.map((r) => r.type))
  const liveTypes = new Set(actual.map((r) => r.type))
  for (const type of wantedTypes) {
    if (!liveTypes.has(type)) problems.push(`${branch}: missing rule type "${type}", which .github/rulesets/${branch}.json requires`)
  }
  for (const type of liveTypes) {
    if (!wantedTypes.has(type)) problems.push(`${branch}: unexpected rule type "${type}", which .github/rulesets/${branch}.json does not list`)
  }
  for (const want of wantedRules) {
    const have = actual.filter((r) => r.type === want.type)
    if (have.length === 0) continue
    if (want.type === 'required_status_checks') {
      problems.push(...compareChecks(branch, want, have))
      continue
    }
    for (const [key, value] of Object.entries(want.parameters ?? {})) {
      for (const rule of have) {
        const live = rule.parameters?.[key]
        if (!same(value, live)) problems.push(`${branch}: ${want.type}.${key} is ${show(live)}, expected ${show(value)}`)
      }
    }
  }
  return [...new Set(problems)]
}

/**
 * Audits every branch and CODEOWNERS. `readRuleset(branch)` returns the parsed ruleset file and
 * `getJson(path)` the parsed GitHub answer. Returns all problems, never throws for a bad answer.
 */
export async function auditRepo({ repo, readRuleset, getJson, branches = BRANCHES }) {
  const problems = []
  for (const branch of branches) {
    let expected
    try {
      expected = readRuleset(branch)
    } catch (error) {
      problems.push(`${branch}: could not read .github/rulesets/${branch}.json (${error.message})`)
      continue
    }
    let actual
    try {
      actual = await getJson(`/repos/${repo}/rules/branches/${branch}?per_page=100`)
    } catch (error) {
      problems.push(`${branch}: could not read the live rules from GitHub (${error.message})`)
      continue
    }
    problems.push(...compareRules(branch, expected, actual))
  }
  try {
    const answer = await getJson(`/repos/${repo}/codeowners/errors`)
    if (!answer || !Array.isArray(answer.errors)) {
      problems.push('CODEOWNERS: GitHub answered with something that is not a list of errors')
    } else {
      for (const e of answer.errors) problems.push(`CODEOWNERS: ${e.message ?? JSON.stringify(e)}`)
    }
  } catch (error) {
    // GitHub answers 404 here when the repository has no CODEOWNERS file at all.
    const hint = /\bHTTP 404\b/.test(error.message) ? ' - is there a .github/CODEOWNERS file?' : ''
    problems.push(`CODEOWNERS: could not read the CODEOWNERS errors from GitHub (${error.message})${hint}`)
  }
  return problems
}

/** A `getJson(path)` for GitHub's REST API. A failure carries GitHub's own message, so CI says why. */
export function githubGetter(token, { base = API, fetchImpl = fetch } = {}) {
  return async (path) => {
    const response = await fetchImpl(`${base}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'rules-audit',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      let detail = ''
      try {
        const body = await response.json()
        if (typeof body?.message === 'string') detail = `: ${body.message.slice(0, 200)}`
      } catch {
        // The body was not JSON; the status line is all there is to report.
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim() + detail)
    }
    return response.json()
  }
}

async function main() {
  const flag = process.argv.indexOf('--repo')
  const repo = flag === -1 ? process.env.GITHUB_REPOSITORY : process.argv[flag + 1]
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set (expected owner/repo)')
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const readRuleset = (branch) =>
    JSON.parse(readFileSync(new URL(`../../.github/rulesets/${branch}.json`, import.meta.url), 'utf8'))

  const problems = await auditRepo({ repo, readRuleset, getJson: githubGetter(token) })

  const summary = problems.length === 0
    ? `rules-audit: OK. The rules enforced on ${BRANCHES.join(' and ')} match .github/rulesets/*.json and CODEOWNERS has no errors (${repo}).`
    : `rules-audit: FAIL (${problems.length} problem${problems.length === 1 ? '' : 's'}) for ${repo}`
  console[problems.length === 0 ? 'log' : 'error'](summary)
  for (const problem of problems) console.error(`  - ${problem}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = problems.length === 0 ? [summary] : [summary, '', ...problems.map((p) => `- ${p}`)]
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  }
  if (problems.length > 0) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`rules-audit: FAIL (${error.message})`)
    process.exit(1)
  })
}
