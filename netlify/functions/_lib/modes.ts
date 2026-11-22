export type PaymentsMode = 'test' | 'live'

/** The payment key is missing or has no recognised prefix. Carries no part of the key. */
export class PaymentKeyError extends Error {
  constructor() {
    super('the payment key is missing or has an unrecognised prefix')
    this.name = 'PaymentKeyError'
  }
}

const PREFIXES: readonly (readonly [prefix: string, mode: PaymentsMode])[] = [
  ['sk_test_', 'test'],
  ['sk_live_', 'live'],
]

/**
 * The mode a payment key's prefix says: sk_test_ is test, sk_live_ is live. Anything else,
 * including a missing key or a prefix with nothing after it, throws instead of guessing.
 */
export function paymentsModeFromKey(key: string | undefined): PaymentsMode {
  if (typeof key === 'string') {
    for (const [prefix, mode] of PREFIXES) {
      if (key.startsWith(prefix) && key.length > prefix.length) return mode
    }
  }
  throw new PaymentKeyError()
}
