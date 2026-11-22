import type { Context } from '@netlify/functions'
import buildInfo from './_lib/build-info.json'
import { fail } from './_lib/errors.ts'
import { PaymentKeyError, paymentsModeFromKey } from './_lib/modes.ts'
import { json } from './_lib/respond.ts'

// GET /api/health: pipeline instrumentation, not an app feature. smoke.yml calls it after every
// deploy to prove which deploy context is running and whether it holds a test or a live payment key.
// The body is the App-to-pipeline contract: functions (_lib/health.schema.json). The route is the
// /api/* redirect in netlify.toml, so no config.path is set here.

const DEPLOY_CONTEXTS = ['production', 'deploy-preview', 'branch-deploy', 'dev'] as const
type DeployContext = (typeof DEPLOY_CONTEXTS)[number]

class DeployContextError extends Error {
  constructor() {
    super('Netlify did not report a known deploy context')
    this.name = 'DeployContextError'
  }
}

const isDeployContext = (value: unknown): value is DeployContext =>
  DEPLOY_CONTEXTS.includes(value as DeployContext)

const hasBody = (req: Request) => req.body !== null || Number(req.headers.get('content-length') ?? 0) > 0

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    if (req.method !== 'GET') return fail(405, 'method_not_allowed')
    if (new URL(req.url).search !== '' || hasBody(req)) return fail(400, 'invalid_request')

    // Netlify's build variables (CONTEXT, BRANCH, COMMIT_REF) do not exist at runtime; this does.
    const deployContext = context.deploy?.context
    if (!isDeployContext(deployContext)) throw new DeployContextError()

    // The key is read here and only here. Only the mode derived from its prefix leaves this function.
    const paymentsMode = paymentsModeFromKey(process.env.PAYMENT_SECRET_KEY)

    // Built field by field: never spread process.env, the context or the request into the answer.
    return json({
      status: 'ok',
      deployContext,
      paymentsMode,
      branch: buildInfo.branch,
      commitRef: buildInfo.commitRef,
    })
  } catch (error) {
    if (error instanceof PaymentKeyError) return fail(500, 'payment_key_missing', error)
    return fail(500, 'request_failed', error)
  }
}
