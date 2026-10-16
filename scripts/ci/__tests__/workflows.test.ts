import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fixturesDir,
  loadWorkflow,
  readText,
  repoRoot,
  stepsOf,
  triggers,
  workflowFiles,
  workflowsDir,
  type Workflow,
} from './helpers.ts'

const TRIVY = 'aquasecurity/trivy-action'

const real = (name: string) => loadWorkflow(join(workflowsDir, name))
const fixture = (name: string) => loadWorkflow(join(fixturesDir, name))

function pullRequestBranches(w: Workflow): { present: boolean; config: Record<string, unknown> } {
  const pr = triggers(w).pull_request
  if (pr === undefined) return { present: false, config: {} }
  return { present: true, config: (pr ?? {}) as Record<string, unknown> }
}

/** REQ-005 AC1: the test workflow runs on every pull request targeting staging or main. */
function checkTestWorkflow(w: Workflow): string[] {
  const problems: string[] = []
  const { present, config } = pullRequestBranches(w)
  if (!present) return ['does not run on pull_request']
  const branches = Array.isArray(config.branches) ? config.branches : []
  for (const b of ['staging', 'main']) {
    if (!branches.includes(b)) problems.push(`pull_request.branches does not include ${b}`)
  }
  if ('paths' in config) problems.push('pull_request has a paths filter, which can skip the tests')
  if ('paths-ignore' in config) {
    problems.push('pull_request has a paths-ignore filter, which can skip the tests')
  }
  const job = w.jobs?.test
  if (!job) problems.push('there is no job named test')
  else if (!stepsOf(job).some((s) => /\bnpm (?:run )?test(?![:\w-])/.test(s.run ?? ''))) {
    problems.push('job test does not run npm test')
  }
  return problems
}

function trivySteps(w: Workflow) {
  return stepsOf(w.jobs?.['security-scan']).filter((s) => s.uses?.startsWith(`${TRIVY}@`))
}

const csv = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()

/** REQ-006 AC1: Trivy fs on every pull request with severity CRITICAL,HIGH and exit-code 1. */
function checkSecurityWorkflow(w: Workflow): string[] {
  const problems: string[] = []
  const { present, config } = pullRequestBranches(w)
  if (!present) problems.push('does not run on pull_request')
  else {
    const branches = Array.isArray(config.branches) ? config.branches : []
    for (const b of ['staging', 'main']) {
      if (!branches.includes(b)) problems.push(`pull_request.branches does not include ${b}`)
    }
  }
  if (!w.jobs?.['security-scan']) return [...problems, 'there is no job named security-scan']
  const scan = trivySteps(w).find(
    (s) => s.with?.['scan-type'] === 'fs' && String(s.with?.['scan-ref'] ?? '.') === '.',
  )
  if (!scan) return [...problems, 'security-scan has no Trivy scan-type: fs step over the repository']
  if (csv(scan.with?.severity).join(',') !== 'CRITICAL,HIGH') {
    problems.push(`severity is "${scan.with?.severity}", expected CRITICAL,HIGH`)
  }
  if (String(scan.with?.['exit-code']) !== '1') {
    problems.push(`exit-code is "${scan.with?.['exit-code']}", expected '1'`)
  }
  return problems
}

/** REQ-008 AC2: the built dist/ is scanned for credentials after the build. */
function checkDistScan(w: Workflow): string[] {
  const steps = stepsOf(w.jobs?.['security-scan'])
  const build = steps.findIndex((s) => /\bnpm run build\b/.test(s.run ?? ''))
  const dist = steps.findIndex((s) => s.uses?.startsWith(`${TRIVY}@`) && s.with?.['scan-ref'] === 'dist')
  const problems: string[] = []
  if (build === -1) problems.push('security-scan never runs npm run build, so there is no dist/ to scan')
  if (dist === -1) {
    problems.push('security-scan has no Trivy step with scan-ref: dist')
    return problems
  }
  if (build !== -1 && dist < build) problems.push('the dist/ scan runs before npm run build')
  const dscan = steps[dist]
  if (!csv(dscan.with?.scanners).includes('secret')) {
    problems.push(`the dist/ scan uses scanners "${dscan.with?.scanners}", expected secret`)
  }
  if (String(dscan.with?.['exit-code']) !== '1') {
    problems.push(`the dist/ scan has exit-code "${dscan.with?.['exit-code']}", expected '1'`)
  }
  return problems
}

describe('ci.yml (REQ-005 AC1)', () => {
  it('runs the tests on every pull request into staging or main', () => {
    expect(checkTestWorkflow(real('ci.yml'))).toEqual([])
  })

  it('runs the app contract scripts in order, then the pipeline checks', () => {
    const runs = stepsOf(real('ci.yml').jobs?.test).map((s) => s.run?.trim())
    const wanted = ['npm ci', 'npm run lint', 'npm run typecheck', 'npm test', 'npm run build', 'npm run test:pipeline']
    const positions = wanted.map((cmd) => runs.indexOf(cmd))
    expect(positions.every((p) => p >= 0), `missing steps: ${wanted.filter((_, i) => positions[i] < 0)}`).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('fails a workflow whose paths filter could skip the tests, naming the filter', () => {
    expect(checkTestWorkflow(fixture('ci.paths-filter.yml')).join('\n')).toMatch(/paths filter/)
  })
})

describe('security.yml (REQ-006 AC1)', () => {
  it('runs Trivy fs on every pull request with CRITICAL,HIGH and exit-code 1', () => {
    expect(checkSecurityWorkflow(real('security.yml'))).toEqual([])
  })

  it('fails a scan that cannot block, naming the severity and exit-code inputs', () => {
    const problems = checkSecurityWorkflow(fixture('security.weak.yml')).join('\n')
    expect(problems).toMatch(/severity/)
    expect(problems).toMatch(/exit-code/)
  })
})

describe('security.yml dist scan (REQ-008 AC2)', () => {
  it('builds, then scans dist/ for secrets with exit-code 1', () => {
    expect(checkDistScan(real('security.yml'))).toEqual([])
  })

  it('fails a workflow that never scans the built output', () => {
    expect(checkDistScan(fixture('security.weak.yml')).join('\n')).toMatch(/scan-ref: dist/)
  })
})

describe('required check names are an interface', () => {
  const REQUIRED = ['test', 'security-scan', 'promotion-source']

  function allJobs() {
    const jobs = new Map<string, { file: string; name?: string; matrix: boolean }>()
    for (const path of workflowFiles()) {
      for (const [id, job] of Object.entries(loadWorkflowJobs(path))) {
        jobs.set(id, { file: path, name: job.name, matrix: Boolean(job.strategy?.matrix) })
      }
    }
    return jobs
  }

  function loadWorkflowJobs(path: string) {
    return loadWorkflow(path).jobs ?? {}
  }

  it('defines test, security-scan and promotion-source, reported under exactly those names', () => {
    const jobs = allJobs()
    for (const id of REQUIRED) {
      const job = jobs.get(id)
      expect(job, `no job with id ${id}`).toBeDefined()
      expect(job?.name === undefined || job.name === id, `job ${id} sets name: ${job?.name}`).toBe(true)
      expect(job?.matrix, `job ${id} is in a matrix, which changes the reported check name`).toBe(false)
    }
  })

  it('every status check the rulesets require is a job that exists', () => {
    const jobs = allJobs()
    const dir = join(repoRoot, '.github', 'rulesets')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const ruleset = JSON.parse(readText(join(dir, file)))
      const checks = ruleset.rules
        .filter((r: { type: string }) => r.type === 'required_status_checks')
        .flatMap((r: { parameters: { required_status_checks: { context: string }[] } }) =>
          r.parameters.required_status_checks.map((c) => c.context),
        )
      for (const context of checks) {
        expect(jobs.has(context), `${file} requires "${context}" but no workflow job has that name`).toBe(true)
      }
    }
  })
})

describe('promotion.yml (the promotion-source check)', () => {
  const w = () => real('promotion.yml')
  const script = () => {
    const step = stepsOf(w().jobs?.['promotion-source']).find((s) => s.run)
    if (!step?.run) throw new Error('promotion-source has no run step')
    return step.run
  }

  it('runs only on pull requests into main', () => {
    const { present, config } = pullRequestBranches(w())
    expect(present).toBe(true)
    expect(config.branches).toEqual(['main'])
  })

  it('reads the branch names from the environment, never interpolated into the script', () => {
    expect(script()).not.toContain('${{')
    const env = stepsOf(w().jobs?.['promotion-source']).find((s) => s.run)?.env ?? {}
    expect(String(env.HEAD_REF)).toContain('github.head_ref')
  })

  const run = (env: Record<string, string>) =>
    spawnSync('bash', ['-c', script()], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })

  it('passes a pull request from staging in this repository', () => {
    const r = run({ HEAD_REF: 'staging', HEAD_REPO: 'acme/app', BASE_REPO: 'acme/app' })
    expect(r.status).toBe(0)
  })

  it('fails a pull request from any other branch', () => {
    const r = run({ HEAD_REF: 'feature/login', HEAD_REPO: 'acme/app', BASE_REPO: 'acme/app' })
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toContain('feature/login')
  })

  it('fails a pull request from a branch called staging in a fork', () => {
    const r = run({ HEAD_REF: 'staging', HEAD_REPO: 'stranger/app', BASE_REPO: 'acme/app' })
    expect(r.status).toBe(1)
  })
})

describe('rules-audit.yml', () => {
  it('runs weekly and by hand only, never on a pull request, and fails closed on its own read-only token', () => {
    const w = real('rules-audit.yml')
    expect(Object.keys(triggers(w)).sort()).toEqual(['schedule', 'workflow_dispatch'])
    const job = w.jobs?.['rules-audit']
    expect(job).toBeDefined()
    const audit = stepsOf(job).find((s) => /rules-audit\.mjs/.test(s.run ?? ''))
    expect(audit, 'no step runs scripts/ci/rules-audit.mjs').toBeDefined()
    expect(String(audit?.env?.GH_TOKEN)).toContain('github.token')
  })
})

describe('smoke.yml', () => {
  it('runs after a successful deployment status and calls the health check script', () => {
    const w = real('smoke.yml')
    expect(Object.keys(triggers(w))).toEqual(['deployment_status'])
    const job = w.jobs?.smoke
    expect(job?.if).toContain("github.event.deployment_status.state == 'success'")
    expect(job?.permissions).toEqual({ contents: 'read', deployments: 'read' })
    const call = stepsOf(job).find((s) => /smoke-health\.mjs/.test(s.run ?? ''))
    expect(call, 'no step runs scripts/ci/smoke-health.mjs').toBeDefined()
    expect(String(call?.env?.DEPLOY_URL)).toContain('deployment_status.environment_url')
  })
})

describe('every workflow', () => {
  it('has a timeout on every job and cancels superseded runs', () => {
    const files = workflowFiles()
    expect(files.length, 'no workflows found in .github/workflows').toBeGreaterThan(0)
    for (const path of files) {
      const w = loadWorkflow(path)
      expect(w.concurrency?.['cancel-in-progress'], `${path} must cancel superseded runs`).toBe(true)
      for (const [id, job] of Object.entries(w.jobs ?? {})) {
        expect(job['timeout-minutes'], `${path} job ${id} needs timeout-minutes`).toBeGreaterThan(0)
      }
    }
  })
})
