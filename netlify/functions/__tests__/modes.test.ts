import { describe, expect, it } from 'vitest'
import { paymentsModeFromKey, PaymentKeyError } from '../_lib/modes.ts'
import { fakeLiveKey, fakeTestKey } from './helpers.ts'

// Supporting tests: not reported against a criterion. They catch a derivation bug before any deploy.
describe('paymentsModeFromKey', () => {
  it('reads sk_test_ as test and sk_live_ as live', () => {
    expect(paymentsModeFromKey(fakeTestKey())).toBe('test')
    expect(paymentsModeFromKey(fakeLiveKey())).toBe('live')
  })

  it.each([
    ['an empty string', ''],
    ['a missing key', undefined],
    ['a publishable key prefix', ['pk', 'live', 'abcdef'].join('_')],
    ['an unrecognised prefix', 'whsec_abcdef'],
    ['a prefix with nothing after it', ['sk', 'live', ''].join('_')],
    ['the wrong case', ['SK', 'LIVE', 'abcdef'].join('_')],
    ['leading whitespace', ` ${fakeLiveKey()}`],
  ])('throws for %s rather than guessing', (_label, key) => {
    expect(() => paymentsModeFromKey(key)).toThrow(PaymentKeyError)
  })

  it('never puts the key in the error', () => {
    const key = ['sk', 'prod', 'abcdefghijklmnop'].join('_')
    try {
      paymentsModeFromKey(key)
      expect.unreachable()
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(key)
    }
  })
})
