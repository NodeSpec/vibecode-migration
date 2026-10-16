import { json } from './respond.ts'

/** The only error codes a caller ever sees. */
export type ErrorCode = 'request_failed' | 'invalid_request' | 'method_not_allowed' | 'payment_key_missing'

/**
 * An error response is a fixed code and a correlation id: never an exception's message, a stack
 * or an upstream body, any of which could carry a secret. When there is a cause, only the
 * correlation id and the error's name are logged, so the id in the response finds the log line.
 */
export function fail(status: number, code: ErrorCode = 'request_failed', cause?: unknown): Response {
  const correlationId = crypto.randomUUID()
  if (cause !== undefined) {
    console.error({ correlationId, name: cause instanceof Error ? cause.name : 'UnknownError' })
  }
  return json({ error: code, correlationId }, status)
}
