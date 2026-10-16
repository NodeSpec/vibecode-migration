import { afterEach, describe, expect, it, vi } from 'vitest'
import { contextFor, fakeLiveKey, getHealth, stubKey } from './helpers.ts'

vi.mock('../_lib/build-info.json', () => ({ default: { branch: 'staging', commitRef: 'abc1234' } }))

const { default: handler } = await import('../health.ts')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// TC-REQ-010-3: /api/health never returns a key or stack trace, and sends Cache-Control: no-store.
describe('/api/health leaks nothing (REQ-010 AC3)', () => {
  it('returns neither the key nor the string sk_, and sends Cache-Control: no-store', async () => {
    const key = fakeLiveKey()
    stubKey(key)
    const response = await handler(getHealth(), contextFor('production'))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain(key)
    expect(text).not.toContain('sk_')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('also hides the key when the key is unusable', async () => {
    const bad = ['sk', 'prod', 'abcdefghijklmnop'].join('_')
    stubKey(bad)
    const response = await handler(getHealth(), contextFor('production'))
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(text).not.toContain(bad)
    expect(text).not.toContain('sk_')
  })

  it('answers an internal error with 500, a correlationId, no stack lines and no-store, and logs no message', async () => {
    const key = fakeLiveKey()
    stubKey(key)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exploding = {
      get deploy(): never {
        throw new Error(`boom with ${key}`)
      },
    } as never
    const response = await handler(getHealth(), exploding)
    const text = await response.text()
    const json = JSON.parse(text)

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(json.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(json.error).toBe('request_failed')
    expect(text).not.toMatch(/\n\s*at |\bat\s+\S+\s+\(/)
    expect(text).not.toContain('boom')
    expect(text).not.toContain(key)

    // The log carries only the correlation id and the error's name, never its message or stack.
    expect(logged).toHaveBeenCalledTimes(1)
    const entry = logged.mock.calls[0]
    expect(entry).toHaveLength(1)
    expect(entry[0]).toEqual({ correlationId: json.correlationId, name: 'Error' })
    expect(JSON.stringify(entry)).not.toContain('boom')
  })
})
