import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.ts'

const SCRIPTS = ['lint', 'typecheck', 'test', 'build'] as const

interface Options {
  /** Also require the publish folder to exist with index.html, as after `npm run build`. */
  built?: boolean
  /** Also require package-lock.json to be tracked by git (needs a git checkout). */
  git?: boolean
}

/** REQ-015 AC1: what the App-to-pipeline contract asks of the app. Returns the problems found. */
function checkContract(root: string, options: Options = {}): string[] {
  const problems: string[] = []
  const file = (name: string) => join(root, name)

  let scripts: Record<string, unknown> = {}
  try {
    scripts = JSON.parse(readFileSync(file('package.json'), 'utf8')).scripts ?? {}
  } catch (error) {
    problems.push(`package.json is missing or not valid JSON (${(error as Error).message})`)
  }
  for (const name of SCRIPTS) {
    const command = scripts[name]
    if (typeof command !== 'string' || command.trim() === '') {
      problems.push(`package.json has no "${name}" script`)
    } else if (/\|\|\s*(?:true|:|exit\s+0)\b|;\s*exit\s+0\b/.test(command)) {
      problems.push(`the "${name}" script ignores failures: ${command}`)
    }
  }

  if (!existsSync(file('.nvmrc'))) problems.push('.nvmrc is missing')
  else if (!/^v?\d+(\.\d+){0,2}$/.test(readFileSync(file('.nvmrc'), 'utf8').trim())) {
    problems.push('.nvmrc does not hold a Node.js version such as 22')
  }

  if (!existsSync(file('package-lock.json'))) problems.push('package-lock.json is missing')
  else if (options.git) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'package-lock.json'], { cwd: root })
    if (tracked.status !== 0) problems.push('package-lock.json is not tracked by git')
  }

  const runbook = existsSync(file('docs/runbook.md')) ? readFileSync(file('docs/runbook.md'), 'utf8') : ''
  const section = runbook.match(/^## App contract\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1]
  const folder = section?.match(/Publish folder:\s*`([^`]+)`/)?.[1]
  if (!section) problems.push('docs/runbook.md has no "App contract" section')
  else if (!folder) problems.push('docs/runbook.md "App contract" does not record the publish folder')
  else if (folder.startsWith('/') || folder.includes('..')) {
    problems.push(`the publish folder "${folder}" must be a folder inside the repository`)
  } else {
    const lines = existsSync(file('.gitignore')) ? readFileSync(file('.gitignore'), 'utf8').split('\n') : []
    const ignored = new Set(lines.map((l) => l.trim().replace(/^\//, '').replace(/\/$/, '')))
    if (!ignored.has(folder)) problems.push(`the publish folder "${folder}" is not listed in .gitignore`)
    if (options.built && !existsSync(join(root, folder, 'index.html'))) {
      problems.push(`${folder}/index.html does not exist: run npm run build first`)
    }
  }
  return problems
}

const scratch: string[] = []
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'contract-'))
  scratch.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

const goodScripts = { lint: 'oxlint', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'vite build' }
const goodProject = (overrides: Record<string, string | undefined> = {}) =>
  project(
    Object.fromEntries(
      Object.entries({
        'package.json': JSON.stringify({ scripts: goodScripts }),
        '.nvmrc': '22\n',
        'package-lock.json': '{}',
        '.gitignore': 'node_modules\ndist\n',
        'docs/runbook.md': '# Runbook\n\n## App contract\n\nPublish folder: `dist`\n\n## Next\n',
        ...overrides,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  )

describe('app-to-pipeline contract (REQ-015 AC1)', () => {
  it('is met by this app: four scripts, a pinned Node.js, a tracked lockfile and a built publish folder', () => {
    expect(checkContract(repoRoot, { built: true, git: true })).toEqual([])
  })

  it('passes a project that meets the contract', () => {
    expect(checkContract(goodProject())).toEqual([])
  })

  it.each(SCRIPTS)('fails a package.json missing the %s script, naming it', (name) => {
    const { [name]: _removed, ...rest } = goodScripts
    const dir = goodProject({ 'package.json': JSON.stringify({ scripts: rest }) })
    expect(checkContract(dir)).toEqual([`package.json has no "${name}" script`])
  })

  it('fails a script that swallows its own failure', () => {
    const dir = goodProject({
      'package.json': JSON.stringify({ scripts: { ...goodScripts, lint: 'oxlint || true' } }),
    })
    expect(checkContract(dir)).toEqual(['the "lint" script ignores failures: oxlint || true'])
  })

  it('fails a missing or malformed .nvmrc and a missing lockfile', () => {
    expect(checkContract(goodProject({ '.nvmrc': undefined }))).toEqual(['.nvmrc is missing'])
    expect(checkContract(goodProject({ '.nvmrc': 'lts/*' }))).toEqual(['.nvmrc does not hold a Node.js version such as 22'])
    expect(checkContract(goodProject({ 'package-lock.json': undefined }))).toEqual(['package-lock.json is missing'])
  })

  it('fails a runbook that does not record the publish folder, or a folder that is not ignored', () => {
    expect(checkContract(goodProject({ 'docs/runbook.md': '# Runbook\n' }))).toEqual([
      'docs/runbook.md has no "App contract" section',
    ])
    expect(checkContract(goodProject({ 'docs/runbook.md': '## App contract\n\nnothing\n' }))).toEqual([
      'docs/runbook.md "App contract" does not record the publish folder',
    ])
    expect(checkContract(goodProject({ '.gitignore': 'node_modules\n' }))).toEqual([
      'the publish folder "dist" is not listed in .gitignore',
    ])
  })

  it('fails a built check when the publish folder has no index.html', () => {
    expect(checkContract(goodProject(), { built: true })).toEqual(['dist/index.html does not exist: run npm run build first'])
    const built = goodProject({ 'dist/index.html': '<!doctype html>' })
    expect(checkContract(built, { built: true })).toEqual([])
  })

  it('observes a non-zero exit code from a project whose test script fails', () => {
    const failing = project({ 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }) })
    const passing = project({ 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }) })
    const run = (cwd: string) => spawnSync('npm', ['run', 'test', '--silent'], { cwd, encoding: 'utf8' }).status
    expect(run(passing)).toBe(0)
    expect(run(failing)).not.toBe(0)
  })
})
