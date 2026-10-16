import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.ts'

const script = join(repoRoot, 'scripts', 'write-build-info.mjs')
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** Runs the postbuild script with only the variables given, and returns what it wrote. */
function write(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'build-info-'))
  scratch.push(dir)
  const out = join(dir, 'nested', 'build-info.json')
  const result = spawnSync(process.execPath, [script, '--out', out], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  })
  let written: unknown
  try {
    written = JSON.parse(readFileSync(out, 'utf8'))
  } catch {
    written = undefined
  }
  return { code: result.status, written, output: `${result.stdout}${result.stderr}` }
}

describe('write-build-info (what /api/health reports as branch and commitRef)', () => {
  it('records the branch and the first 7 characters of the commit that Netlify builds', () => {
    const { code, written } = write({ BRANCH: 'staging', COMMIT_REF: '0123456789abcdef0123456789abcdef01234567' })
    expect(code).toBe(0)
    expect(written).toEqual({ branch: 'staging', commitRef: '0123456' })
  })

  it('records "local" outside a Netlify build, so a local build still works', () => {
    expect(write({}).written).toEqual({ branch: 'local', commitRef: 'local' })
  })

  it('keeps a branch name with awkward characters as plain data', () => {
    const { written } = write({ BRANCH: 'feat/"quote"\\slash', COMMIT_REF: 'abcdef1234' })
    expect(written).toEqual({ branch: 'feat/"quote"\\slash', commitRef: 'abcdef1' })
  })

  it('writes only the two fields and nothing else from the environment', () => {
    const { written } = write({ BRANCH: 'main', COMMIT_REF: 'abcdef1234', PAYMENT_SECRET_KEY: 'do-not-write-me' })
    expect(Object.keys(written as object).sort()).toEqual(['branch', 'commitRef'])
  })
})
