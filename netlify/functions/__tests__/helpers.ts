import type { Context } from '@netlify/functions'
import { vi } from 'vitest'

// Built from parts so no complete key-like literal is committed for a secret scan to find.
export const fakeLiveKey = () => ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2'].join('_')
export const fakeTestKey = () => ['sk', 'test', 'z9Y8x7W6v5U4t3S2r1Q0p9O8'].join('_')

/** The part of Netlify's v2 Context that the handler reads. */
export const contextFor = (deployContext: string | undefined): Context =>
  ({ deploy: { context: deployContext, id: 'deploy-1', published: false } }) as unknown as Context

export const getHealth = (init: RequestInit = {}, path = '/api/health') =>
  new Request(`https://example.test${path}`, { method: 'GET', ...init })

/** The build-time file the postbuild script writes; tests choose its content. */
export const BUILD_INFO = { branch: 'staging', commitRef: 'abc1234' }

export function stubKey(value: string | undefined) {
  if (value === undefined) vi.stubEnv('PAYMENT_SECRET_KEY', undefined as unknown as string)
  else vi.stubEnv('PAYMENT_SECRET_KEY', value)
}
