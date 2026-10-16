import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILD_INFO, contextFor, fakeLiveKey, fakeTestKey, getHealth, stubKey } from './helpers.ts'

vi.mock('../_lib/build-info.json', () => ({ default: { branch: 'staging', commitRef: 'abc1234' } }))

const { default: handler } = await import('../health.ts')

afterEach(() => vi.unstubAllEnvs())

const body = async (response: Response) => JSON.parse(await response.text())

// Supporting tests of the handler's derivation. That each real deploy reports test or live is proven
// by smoke.yml on that deploy (TC-REQ-010-1 and TC-REQ-010-2), not here.
describe('GET /api/health', () => {
  it.each([
    ['deploy-preview', fakeTestKey(), 'test'],
    ['branch-deploy', fakeTestKey(), 'test'],
    ['production', fakeLiveKey(), 'live'],
    ['dev', fakeTestKey(), 'test'],
  ])('in the %s context with that deploy\'s key reports the mode its prefix says', async (deployContext, key, mode) => {
    stubKey(key)
    const response = await handler(getHealth(), contextFor(deployContext))
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ status: 'ok', deployContext, paymentsMode: mode, ...BUILD_INFO })
  })

  it('reports what the key says, so a preview holding a live key is visible rather than hidden', async () => {
    stubKey(fakeLiveKey())
    const response = await handler(getHealth(), contextFor('deploy-preview'))
    expect((await body(response)).paymentsMode).toBe('live')
  })

  it('answers with exactly the contract fields, never anything from the environment or the request', async () => {
    stubKey(fakeTestKey())
    vi.stubEnv('DATABASE_PASSWORD', 'hunter2-should-never-appear')
    const request = getHealth({ headers: { Authorization: 'Bearer abc', Cookie: 'sid=1' } })
    const response = await handler(request, contextFor('deploy-preview'))
    const json = await body(response)
    expect(Object.keys(json).sort()).toEqual(['branch', 'commitRef', 'deployContext', 'paymentsMode', 'status'])
    expect(JSON.stringify(json)).not.toMatch(/hunter2|Bearer|sid=1/)
  })

  it('always sends JSON, Cache-Control: no-store and no CORS header', async () => {
    stubKey(fakeTestKey())
    for (const request of [getHealth(), getHealth({ method: 'POST' }), getHealth({}, '/api/health?x=1')]) {
      const response = await handler(request, contextFor('deploy-preview'))
      expect(response.headers.get('content-type')).toMatch(/^application\/json/)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    }
  })

  it('fails with payment_key_missing when the key is missing or unrecognised', async () => {
    for (const key of [undefined, '', 'not-a-key']) {
      stubKey(key)
      const response = await handler(getHealth(), contextFor('production'))
      expect(response.status).toBe(500)
      expect(await body(response)).toMatchObject({ error: 'payment_key_missing' })
    }
  })

  it('does not guess a deploy context Netlify did not report', async () => {
    stubKey(fakeTestKey())
    for (const unknown of [undefined, 'preview', '']) {
      const response = await handler(getHealth(), contextFor(unknown))
      expect(response.status).toBe(500)
      expect(await body(response)).toMatchObject({ error: 'request_failed' })
    }
  })

  it('rejects anything but GET with 405, a query string or a body with 400', async () => {
    stubKey(fakeTestKey())
    const post = await handler(getHealth({ method: 'POST', body: '{}' }), contextFor('deploy-preview'))
    expect([post.status, (await body(post)).error]).toEqual([405, 'method_not_allowed'])
    const query = await handler(getHealth({}, '/api/health?debug=1'), contextFor('deploy-preview'))
    expect([query.status, (await body(query)).error]).toEqual([400, 'invalid_request'])
    const withBody = await handler(
      new Request('https://example.test/api/health', { method: 'GET', headers: { 'content-length': '2' } }),
      contextFor('deploy-preview'),
    )
    expect([withBody.status, (await body(withBody)).error]).toEqual([400, 'invalid_request'])
  })
})
