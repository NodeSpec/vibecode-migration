/**
 * Every response goes through here, so Content-Type and Cache-Control: no-store cannot be forgotten.
 * No CORS header is ever set: the endpoint is same-origin only.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
