import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contextFor, fakeLiveKey, fakeTestKey, getHealth, stubKey } from './helpers.ts'

vi.mock('../_lib/build-info.json', () => ({ default: { branch: 'staging', commitRef: 'abc1234' } }))

const { default: handler } = await import('../health.ts')

afterEach(() => vi.unstubAllEnvs())

// The contract is the schema committed from NodeSpec; these tests never read the other side's code.
const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '_lib', 'health.schema.json'), 'utf8'))
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema)

const CONTEXTS = [
  ['production', fakeLiveKey],
  ['deploy-preview', fakeTestKey],
  ['branch-deploy', fakeTestKey],
  ['dev', fakeTestKey],
] as const

// Supporting test: every response is checked against the schema on every pull request.
describe('App-to-pipeline contract: functions', () => {
  it.each(CONTEXTS)('a 200 in the %s context is valid against health.schema.json', async (deployContext, key) => {
    stubKey(key())
    const response = await handler(getHealth(), contextFor(deployContext))
    expect(response.status).toBe(200)
    const json = JSON.parse(await response.text())
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true)
  })

  it('the schema rejects what the contract forbids, so the check above is not vacuous', () => {
    const ok = { status: 'ok', deployContext: 'production', paymentsMode: 'live' }
    expect(validate(ok)).toBe(true)
    expect(validate({ ...ok, extra: 1 })).toBe(false)
    expect(validate({ ...ok, paymentsMode: 'maybe' })).toBe(false)
    expect(validate({ ...ok, status: 'degraded' })).toBe(false)
    const { deployContext: _gone, ...missing } = ok
    expect(validate(missing)).toBe(false)
  })

  it('every error is { error: <fixed code>, correlationId } with a unique correlation id', async () => {
    const seen = new Set<string>()
    const codes = new Set<string>()
    const cases: [Request, string | undefined][] = [
      [getHealth({ method: 'DELETE' }), 'production'],
      [getHealth({}, '/api/health?x=1'), 'production'],
      [getHealth(), undefined],
      [getHealth(), 'production'],
    ]
    for (const [request, deployContext] of cases) {
      stubKey(deployContext === 'production' ? undefined : fakeTestKey())
      const response = await handler(request, contextFor(deployContext))
      expect(response.status).toBeGreaterThanOrEqual(400)
      const json = JSON.parse(await response.text())
      expect(Object.keys(json).sort()).toEqual(['correlationId', 'error'])
      expect(json.correlationId).toMatch(/^[0-9a-f-]{36}$/)
      seen.add(json.correlationId)
      codes.add(json.error)
    }
    expect(seen.size).toBe(cases.length)
    expect([...codes].every((c) => ['request_failed', 'invalid_request', 'method_not_allowed', 'payment_key_missing'].includes(c))).toBe(true)
  })
})
