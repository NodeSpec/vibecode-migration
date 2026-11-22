import { describe, expect, it } from 'vitest'
import { evaluateHealth } from '../smoke-health.mjs'

// Built at run time so no key-like text is committed for a secret scan to find.
const fakeKey = ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2'].join('_')

const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function reply(over: {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  environment?: string
}) {
  return {
    status: over.status ?? 200,
    headers: over.headers ?? json,
    bodyText: typeof over.body === 'string' ? over.body : JSON.stringify(over.body),
    environment: over.environment ?? 'Production',
  }
}

const production = { status: 'ok', deployContext: 'production', paymentsMode: 'live', branch: 'main', commitRef: 'abc1234' }
const preview = { status: 'ok', deployContext: 'deploy-preview', paymentsMode: 'test' }

describe('smoke-health (the /api/health contract)', () => {
  it('passes production reporting live payments', () => {
    expect(evaluateHealth(reply({ body: production }))).toEqual([])
  })

  it.each([
    ['Deploy Preview', preview],
    ['deploy-preview', preview],
    ['staging', { ...preview, deployContext: 'branch-deploy' }],
    ['Branch Deploy', { ...preview, deployContext: 'branch-deploy' }],
  ])('passes the %s environment reporting test payments', (environment, body) => {
    expect(evaluateHealth(reply({ environment, body }))).toEqual([])
  })

  it('fails a preview or staging deploy that reports live payments, naming the environment', () => {
    const problems = evaluateHealth(reply({ environment: 'Deploy Preview', body: { ...preview, paymentsMode: 'live' } }))
    expect(problems.join('\n')).toMatch(/Deploy Preview.*paymentsMode.*live.*test/)
  })

  it('fails production reporting test payments', () => {
    const problems = evaluateHealth(reply({ body: { ...production, paymentsMode: 'test' } }))
    expect(problems.join('\n')).toMatch(/Production.*paymentsMode.*test.*live/)
  })

  it('fails a deploy context that disagrees with the environment', () => {
    expect(evaluateHealth(reply({ body: { ...production, deployContext: 'deploy-preview' } })).join('\n')).toMatch(/deployContext/)
    expect(evaluateHealth(reply({ environment: 'Deploy Preview', body: { ...preview, deployContext: 'production' } })).join('\n')).toMatch(
      /deployContext/,
    )
  })

  it('fails a response that is not 200', () => {
    const problems = evaluateHealth(reply({ status: 500, body: { error: 'x', correlationId: 'y' } }))
    expect(problems.join('\n')).toMatch(/status 500/)
  })

  it('fails a missing Cache-Control: no-store and a body that is not JSON', () => {
    const noCache = evaluateHealth(reply({ headers: { 'content-type': 'application/json' }, body: production }))
    expect(noCache.join('\n')).toMatch(/Cache-Control.*no-store/)
    const html = evaluateHealth(reply({ headers: { ...json, 'content-type': 'text/html' }, body: '<html></html>' }))
    expect(html.join('\n')).toMatch(/application\/json/)
    expect(evaluateHealth(reply({ body: 'not json' })).join('\n')).toMatch(/not valid JSON/)
  })

  it('fails a body that holds anything shaped like a key, without repeating it', () => {
    const problems = evaluateHealth(reply({ body: { ...production, branch: fakeKey } }))
    expect(problems.join('\n')).toMatch(/key/)
    expect(problems.join('\n')).not.toContain(fakeKey)
  })

  it('fails a stack trace in the body', () => {
    const body = { ...production, branch: 'Error: boom\n    at handler (/var/task/health.js:12:9)' }
    expect(evaluateHealth(reply({ body })).join('\n')).toMatch(/stack trace/)
  })

  it('fails missing fields, wrong values and extra fields, naming each', () => {
    const { deployContext: _gone, ...missing } = production
    expect(evaluateHealth(reply({ body: missing })).join('\n')).toMatch(/deployContext/)
    expect(evaluateHealth(reply({ body: { ...production, status: 'degraded' } })).join('\n')).toMatch(/status/)
    expect(evaluateHealth(reply({ body: { ...production, paymentsMode: 'maybe' } })).join('\n')).toMatch(/paymentsMode/)
    expect(evaluateHealth(reply({ body: { ...production, debug: true } })).join('\n')).toMatch(/debug/)
  })
})
