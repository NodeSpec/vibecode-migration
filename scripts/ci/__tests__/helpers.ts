import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const fixturesDir = join(repoRoot, 'scripts', 'ci', '__fixtures__')
export const workflowsDir = join(repoRoot, '.github', 'workflows')

export interface Step {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}

export interface Job {
  name?: string
  if?: string
  'runs-on'?: unknown
  'timeout-minutes'?: number
  permissions?: unknown
  strategy?: { matrix?: unknown }
  steps?: Step[]
}

export interface Workflow {
  name?: string
  on?: unknown
  permissions?: unknown
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, Job>
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

export function parseWorkflow(text: string): Workflow {
  const doc = load(text)
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('workflow is not a YAML mapping')
  }
  return doc as Workflow
}

export function loadWorkflow(path: string): Workflow {
  return parseWorkflow(readText(path))
}

/** Absolute paths of every workflow file in .github/workflows. */
export function workflowFiles(): string[] {
  if (!existsSync(workflowsDir)) return []
  return readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => join(workflowsDir, name))
}

/** The `on:` block as a map from event name to its config, whatever form it was written in. */
export function triggers(wf: Workflow): Record<string, unknown> {
  const on = wf.on
  if (typeof on === 'string') return { [on]: null }
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [String(event), null]))
  if (on && typeof on === 'object') return on as Record<string, unknown>
  return {}
}

export function stepsOf(job: Job | undefined): Step[] {
  return Array.isArray(job?.steps) ? job.steps : []
}
