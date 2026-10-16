import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.ts'
import { auditRepo, githubGetter } from '../rules-audit.mjs'

type Rule = { type: string; parameters?: Record<string, unknown> }

const readRuleset = (branch: string) =>
  JSON.parse(readFileSync(join(repoRoot, '.github', 'rulesets', `${branch}.json`), 'utf8'))

/** What GitHub's rules API returns for a branch whose ruleset was applied exactly as the file says. */
function live(branch: string, edit: (rules: Rule[]) => Rule[] = (r) => r): Rule[] {
  const rules: Rule[] = structuredClone(readRuleset(branch).rules)
  return edit(
    rules.map((r) => ({ ...r, ruleset_source_type: 'Repository', ruleset_source: 'acme/app', ruleset_id: 7 })),
  )
}

function withParams(rules: Rule[], type: string, change: Record<string, unknown>): Rule[] {
  return rules.map((r) => (r.type === type ? { ...r, parameters: { ...r.parameters, ...change } } : r))
}

interface Responses {
  main?: unknown
  staging?: unknown
  codeowners?: unknown
}

function api(responses: Responses = {}) {
  return async (path: string) => {
    const answer = path.includes('/rules/branches/main')
      ? (responses.main ?? live('main'))
      : path.includes('/rules/branches/staging')
        ? (responses.staging ?? live('staging'))
        : path.includes('/codeowners/errors')
          ? (responses.codeowners ?? { errors: [] })
          : new Error(`unexpected path ${path}`)
    if (answer instanceof Error) throw answer
    return answer
  }
}

const audit = (responses?: Responses) => auditRepo({ repo: 'acme/app', readRuleset, getJson: api(responses) })

describe('rules-audit comparison (fails closed)', () => {
  it('passes when the live rules match both ruleset files and CODEOWNERS has no errors', async () => {
    expect(await audit()).toEqual([])
  })

  it('reads the live rules of the right repository and branches', async () => {
    const paths: string[] = []
    await auditRepo({
      repo: 'acme/app',
      readRuleset,
      getJson: async (path: string) => {
        paths.push(path)
        return api()(path)
      },
    })
    expect(paths.some((p) => p.startsWith('/repos/acme/app/rules/branches/main'))).toBe(true)
    expect(paths.some((p) => p.startsWith('/repos/acme/app/rules/branches/staging'))).toBe(true)
    expect(paths.some((p) => p.startsWith('/repos/acme/app/codeowners/errors'))).toBe(true)
  })

  it('ignores parameters GitHub adds that the file does not mention', async () => {
    const main = live('main', (rules) => withParams(rules, 'pull_request', { automatic_copilot_code_review_enabled: false }))
    expect(await audit({ main })).toEqual([])
  })

  it('fails a missing required check, naming the branch and the check', async () => {
    const main = live('main', (rules) =>
      withParams(rules, 'required_status_checks', {
        required_status_checks: [{ context: 'test' }, { context: 'security-scan' }],
      }),
    )
    const problems = await audit({ main })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/main/)
    expect(problems[0]).toMatch(/promotion-source/)
  })

  it('fails an extra required check the file does not list', async () => {
    const staging = live('staging', (rules) =>
      withParams(rules, 'required_status_checks', {
        required_status_checks: [{ context: 'test' }, { context: 'security-scan' }, { context: 'lint' }],
      }),
    )
    const problems = await audit({ staging })
    expect(problems.join('\n')).toMatch(/staging.*lint/)
  })

  it('fails an extra merge method on main, naming the field', async () => {
    const main = live('main', (rules) => withParams(rules, 'pull_request', { allowed_merge_methods: ['merge', 'squash'] }))
    const problems = await audit({ main })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/main/)
    expect(problems[0]).toMatch(/allowed_merge_methods/)
  })

  it('fails weaker pull request settings on staging', async () => {
    const staging = live('staging', (rules) =>
      withParams(rules, 'pull_request', { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false }),
    )
    const problems = (await audit({ staging })).join('\n')
    expect(problems).toMatch(/staging.*required_approving_review_count/)
    expect(problems).toMatch(/staging.*dismiss_stale_reviews_on_push/)
  })

  it('fails code owner review switched off', async () => {
    const main = live('main', (rules) => withParams(rules, 'pull_request', { require_code_owner_review: false }))
    expect((await audit({ main })).join('\n')).toMatch(/main.*require_code_owner_review/)
  })

  it('fails a missing rule type and an unexpected one', async () => {
    const missing = await audit({ main: live('main', (rules) => rules.filter((r) => r.type !== 'non_fast_forward')) })
    expect(missing.join('\n')).toMatch(/main.*non_fast_forward/)
    const extra = await audit({ staging: live('staging', (rules) => [...rules, { type: 'creation' }]) })
    expect(extra.join('\n')).toMatch(/staging.*creation/)
  })

  it('fails closed on an empty rule list, naming the branch', async () => {
    const problems = await audit({ main: [], staging: [] })
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/main.*no active rules/)
    expect(problems.join('\n')).toMatch(/staging.*no active rules/)
  })

  it('fails closed on an API error and on an answer that is not a list', async () => {
    const errored = await audit({ staging: new Error('HTTP 403 Forbidden') })
    expect(errored.join('\n')).toMatch(/staging.*could not read.*403/)
    const odd = await audit({ main: { message: 'Not Found' } })
    expect(odd.join('\n')).toMatch(/main.*not a list/)
  })

  it('fails when GitHub reports CODEOWNERS errors, or the check cannot be read', async () => {
    const errors = { errors: [{ line: 3, column: 1, kind: 'Unknown owner', source: '/.github/ @nobody', message: 'Unknown owner on line 3' }] }
    expect((await audit({ codeowners: errors })).join('\n')).toMatch(/CODEOWNERS.*Unknown owner on line 3/)
    expect((await audit({ codeowners: new Error('HTTP 404') })).join('\n')).toMatch(/CODEOWNERS.*could not read.*404/)
  })

  it('points at a missing CODEOWNERS file when GitHub answers 404, and not for other errors', async () => {
    expect((await audit({ codeowners: new Error('HTTP 404 Not Found: Not Found') })).join('\n')).toMatch(
      /is there a \.github\/CODEOWNERS file\?/,
    )
    expect((await audit({ codeowners: new Error('HTTP 403 Forbidden') })).join('\n')).not.toMatch(/is there a/)
  })

  it('reports every problem in one run, not just the first', async () => {
    const problems = await audit({
      main: live('main', (rules) => withParams(rules, 'pull_request', { allowed_merge_methods: ['merge', 'rebase'] })),
      staging: [],
    })
    expect(problems.length).toBeGreaterThanOrEqual(2)
  })
})

describe('reading GitHub (githubGetter)', () => {
  const answer = (init: { status: number; statusText?: string; body: unknown }) =>
    new Response(typeof init.body === 'string' ? init.body : JSON.stringify(init.body), {
      status: init.status,
      statusText: init.statusText ?? '',
    })

  it('sends the API version, the token as a bearer credential and reads JSON', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      return answer({ status: 200, body: [{ type: 'deletion' }] })
    }
    const getJson = githubGetter('t0ken', { base: 'https://api.test', fetchImpl })
    expect(await getJson('/repos/acme/app/rules/branches/main')).toEqual([{ type: 'deletion' }])
    expect(calls[0].url).toBe('https://api.test/repos/acme/app/rules/branches/main')
    expect(calls[0].headers.Authorization).toBe('Bearer t0ken')
    expect(calls[0].headers['X-GitHub-Api-Version']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sends no credential when there is no token', async () => {
    let sent: Record<string, string> = {}
    const fetchImpl = async (_url: string, init: { headers: Record<string, string> }) => {
      sent = init.headers
      return answer({ status: 200, body: [] })
    }
    await githubGetter(undefined, { fetchImpl })('/x')
    expect(sent).not.toHaveProperty('Authorization')
  })

  it("fails with the status and GitHub's own message, so the log says why", async () => {
    const fetchImpl = async () =>
      answer({ status: 403, statusText: 'Forbidden', body: { message: 'API rate limit exceeded for 203.0.113.9' } })
    await expect(githubGetter('t', { fetchImpl })('/x')).rejects.toThrow(
      'HTTP 403 Forbidden: API rate limit exceeded for 203.0.113.9',
    )
  })

  it('still reports the status when the error body is not JSON, and never repeats the token', async () => {
    const fetchImpl = async () => answer({ status: 502, statusText: 'Bad Gateway', body: '<html>oops</html>' })
    const error = await githubGetter('s3cret-t0ken', { fetchImpl })('/x').catch((e: Error) => e)
    expect((error as Error).message).toBe('HTTP 502 Bad Gateway')
    expect((error as Error).message).not.toContain('s3cret-t0ken')
  })
})
