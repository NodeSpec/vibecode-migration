import { basename, join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { fixturesDir, readText, repoRoot, workflowFiles } from './helpers.ts'

const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/

interface Violation {
  file: string
  line: number
  ref: string
  reason: string
}

const format = (v: Violation) => `${v.file}:${v.line} ${v.ref} ${v.reason}`

/** REQ-007 AC1: every non-local `uses:` is owner/repo@<40-hex SHA> with a version comment. */
function findUnpinned(files: { path: string; text: string }[]): Violation[] {
  const found: Violation[] = []
  for (const { path, text } of files) {
    text.split('\n').forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s+)?uses:\s*(["']?)([^\s"'#]+)\1(?:\s*#\s*(\S.*))?\s*$/)
      if (!m) return
      const ref = m[2]
      if (ref.startsWith('./')) return
      const where = { file: basename(path), line: i + 1, ref }
      if (!PINNED.test(ref)) {
        found.push({ ...where, reason: 'is not pinned to a full 40-character commit SHA' })
      } else if (!m[3]) {
        found.push({ ...where, reason: 'has no trailing version comment' })
      }
    })
  }
  return found
}

const SHA = 'a'.repeat(40)

describe('action pins (REQ-007 AC1)', () => {
  it('pins every third-party action in .github/workflows to a full commit SHA with a version comment', () => {
    const files = workflowFiles()
    expect(files.length, 'no workflows found in .github/workflows').toBeGreaterThan(0)
    const violations = findUnpinned(files.map((path) => ({ path, text: readText(path) })))
    expect(violations.map(format)).toEqual([])
  })

  it('fails a workflow that uses a version tag, naming the file, line and ref', () => {
    const path = join(fixturesDir, 'workflow.unpinned.yml')
    const text = readText(path)
    const violations = findUnpinned([{ path, text }])
    const expectedLine = text.split('\n').findIndex((l) => l.includes('uses:')) + 1
    expect(violations).toHaveLength(1)
    expect(format(violations[0])).toBe(
      `workflow.unpinned.yml:${expectedLine} actions/checkout@v4 is not pinned to a full 40-character commit SHA`,
    )
  })

  it('fails a short SHA, a branch name and a docker image, and ignores local actions', () => {
    const text = [
      'steps:',
      '  - uses: actions/checkout@3d3c42e # v7',
      '  - uses: actions/setup-node@main',
      '  - uses: docker://alpine:3',
      '  - uses: ./.github/actions/local',
      `  - uses: actions/cache@${SHA} # v4.2.0`,
    ].join('\n')
    expect(findUnpinned([{ path: 'x.yml', text }]).map((v) => v.ref)).toEqual([
      'actions/checkout@3d3c42e',
      'actions/setup-node@main',
      'docker://alpine:3',
    ])
  })

  it('fails a pinned action that has no version comment', () => {
    const v = findUnpinned([{ path: 'x.yml', text: `- uses: actions/checkout@${SHA}` }])
    expect(v.map((x) => x.reason)).toEqual(['has no trailing version comment'])
  })

  it('accepts quoted references and reads the comment after them', () => {
    const text = `      - uses: "actions/checkout@${SHA}" # v7.0.1`
    expect(findUnpinned([{ path: 'x.yml', text }])).toEqual([])
  })
})

type Dependabot = { updates?: { 'package-ecosystem'?: string; schedule?: { interval?: string } }[] }

/** REQ-007 AC2: Dependabot covers the github-actions and npm ecosystems. */
function checkDependabot(config: Dependabot): string[] {
  const problems: string[] = []
  for (const ecosystem of ['github-actions', 'npm']) {
    const entry = config.updates?.find((u) => u['package-ecosystem'] === ecosystem)
    if (!entry) problems.push(`no update entry for ${ecosystem}`)
    else if (!entry.schedule?.interval) problems.push(`the ${ecosystem} entry has no schedule.interval`)
  }
  return problems
}

describe('dependabot (REQ-007 AC2)', () => {
  it('updates github-actions and npm on a schedule', () => {
    const config = load(readText(join(repoRoot, '.github', 'dependabot.yml'))) as Dependabot
    expect(checkDependabot(config)).toEqual([])
  })

  it('fails a config that leaves out an ecosystem or a schedule', () => {
    const missing = load('version: 2\nupdates:\n  - package-ecosystem: npm\n    schedule:\n      interval: weekly\n')
    expect(checkDependabot(missing as Dependabot)).toEqual(['no update entry for github-actions'])
    const noSchedule = load('updates:\n  - package-ecosystem: github-actions\n  - package-ecosystem: npm\n    schedule:\n      interval: daily\n')
    expect(checkDependabot(noSchedule as Dependabot)).toEqual(['the github-actions entry has no schedule.interval'])
  })
})
