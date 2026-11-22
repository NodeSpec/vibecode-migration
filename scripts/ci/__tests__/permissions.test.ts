import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixturesDir, loadWorkflow, parseWorkflow, triggers, workflowFiles, type Workflow } from './helpers.ts'

/** REQ-016 AC1: read-only at the top, widened only per job, never pull_request_target. */
function checkLeastPrivilege(w: Workflow): string[] {
  const problems: string[] = []
  const top = w.permissions
  const readOnly =
    top !== null &&
    typeof top === 'object' &&
    !Array.isArray(top) &&
    Object.keys(top).length === 1 &&
    (top as Record<string, unknown>).contents === 'read'
  if (top === undefined) problems.push('has no top-level permissions, so the token default applies')
  else if (!readOnly) problems.push(`top-level permissions is ${JSON.stringify(top)}, expected { contents: read }`)
  for (const [id, job] of Object.entries(w.jobs ?? {})) {
    if (job.permissions === 'write-all') problems.push(`job ${id} sets permissions: write-all`)
  }
  if ('pull_request_target' in triggers(w)) problems.push('uses the pull_request_target trigger')
  return problems
}

describe('workflow permissions (REQ-016 AC1)', () => {
  it('starts every workflow read-only and never uses pull_request_target', () => {
    const files = workflowFiles()
    expect(files.length, 'no workflows found in .github/workflows').toBeGreaterThan(0)
    for (const path of files) {
      expect(checkLeastPrivilege(loadWorkflow(path)), path).toEqual([])
    }
  })

  it('fails a workflow with no top-level permissions, naming the problem', () => {
    const problems = checkLeastPrivilege(loadWorkflow(join(fixturesDir, 'workflow.no-permissions.yml')))
    expect(problems.join('\n')).toMatch(/no top-level permissions/)
  })

  it('fails a workflow triggered by pull_request_target', () => {
    const problems = checkLeastPrivilege(loadWorkflow(join(fixturesDir, 'workflow.prt.yml')))
    expect(problems.join('\n')).toMatch(/pull_request_target/)
  })

  it.each([
    ['a string', 'on: pull_request_target'],
    ['a list', 'on: [push, pull_request_target]'],
    ['a map', 'on:\n  pull_request_target:\n    types: [opened]'],
  ])('catches pull_request_target written as %s', (_form, on) => {
    const w = parseWorkflow(`${on}\npermissions:\n  contents: read\njobs: {}\n`)
    expect(checkLeastPrivilege(w)).toEqual(['uses the pull_request_target trigger'])
  })

  it('fails write-all, a write scope at the top, and extra top-level scopes', () => {
    const writeAll = parseWorkflow('on: push\npermissions:\n  contents: read\njobs:\n  a:\n    permissions: write-all\n')
    expect(checkLeastPrivilege(writeAll)).toEqual(['job a sets permissions: write-all'])
    const topWrite = parseWorkflow('on: push\npermissions:\n  contents: write\njobs: {}\n')
    expect(checkLeastPrivilege(topWrite)[0]).toMatch(/expected \{ contents: read \}/)
    const extra = parseWorkflow('on: push\npermissions:\n  contents: read\n  deployments: read\njobs: {}\n')
    expect(checkLeastPrivilege(extra)[0]).toMatch(/expected \{ contents: read \}/)
  })

  it('allows a job to widen its own permissions', () => {
    const w = parseWorkflow(
      'on: push\npermissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      contents: read\n      deployments: read\n',
    )
    expect(checkLeastPrivilege(w)).toEqual([])
  })
})
