import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { repoRoot } from './helpers.ts'

const script = join(repoRoot, 'scripts', 'ci', 'check-public-env.mjs')
const scratch: string[] = []

/** A throwaway project directory. Fixtures are written at test time so no key-like text is committed. */
function project(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'public-env-'))
  scratch.push(dir)
  for (const [rel, content] of Object.entries({ '.github/public-env-allowlist.json': '[]', ...files })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}

function run(root: string) {
  const r = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' })
  return { code: r.status, output: `${r.stdout}${r.stderr}` }
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** A rejection is exit 1 with a message. A crash also exits 1, so a stack trace does not count. */
function expectRejected(result: { code: number | null; output: string }, ...mentions: string[]) {
  expect(result.code).toBe(1)
  expect(result.output).not.toMatch(/node:internal|\n\s+at /)
  for (const text of mentions) expect(result.output).toContain(text)
}

describe('check-public-env (REQ-008 AC1)', () => {
  it('passes this repository', () => {
    const { code, output } = run(repoRoot)
    expect(output).toContain('check-public-env')
    expect(code).toBe(0)
  })

  it('passes public values and server-side secrets that carry no browser prefix', () => {
    const dir = project({
      '.env.example': '# comment\nVITE_APP_NAME=Split the bill\n',
      'src/App.tsx': 'export const name = import.meta.env.VITE_APP_NAME\n',
      'netlify.toml': '[build.environment]\n  NODE_VERSION = "22"\n',
      'netlify/functions/health.ts': 'const key = process.env.PAYMENT_SECRET_KEY\nconst a = process.env.SUPABASE_SERVICE_ROLE_KEY\n',
    })
    expect(run(dir).code).toBe(0)
  })

  it('exits 1 naming the file and variable for a secret-named VITE_ variable in .env.example', () => {
    expectRejected(run(project({ '.env.example': 'VITE_STRIPE_SECRET_KEY=\n' })), '.env.example', 'VITE_STRIPE_SECRET_KEY')
  })

  it.each([
    ['NEXT_PUBLIC_API_TOKEN', 'src/lib/api.ts', 'const t = process.env.NEXT_PUBLIC_API_TOKEN\n'],
    ['VITE_DB_PASSWORD', 'src/config.ts', 'export const p = import.meta.env.VITE_DB_PASSWORD\n'],
    ['VITE_PAYMENT_SECRET', 'netlify.toml', '[build.environment]\n  VITE_PAYMENT_SECRET = "x"\n'],
    ['VITE_ANALYTICS_KEY', 'netlify/functions/track.ts', 'process.env.VITE_ANALYTICS_KEY\n'],
  ])('catches %s in %s', (name, file, content) => {
    expectRejected(run(project({ [file]: content })), name, file)
  })

  it('matches names case-insensitively', () => {
    expectRejected(run(project({ 'src/x.ts': 'const v = import.meta.env.vite_api_key\n' })), 'vite_api_key')
  })

  it('catches a name in a .env file other than .env.example', () => {
    expectRejected(run(project({ '.env.production': 'VITE_SESSION_TOKEN=\n' })), '.env.production', 'VITE_SESSION_TOKEN')
  })

  it('passes a name listed in the allowlist with a reason', () => {
    const dir = project({
      '.env.example': 'VITE_SUPABASE_ANON_KEY=\n',
      '.github/public-env-allowlist.json': JSON.stringify([
        { name: 'VITE_SUPABASE_ANON_KEY', reason: 'public by design: the anon key is protected by row level security' },
      ]),
    })
    expect(run(dir).code).toBe(0)
  })

  it('exits 1 naming the entry when an allowlist entry has no reason', () => {
    const dir = project({
      '.env.example': 'VITE_SUPABASE_ANON_KEY=\n',
      '.github/public-env-allowlist.json': JSON.stringify([{ name: 'VITE_SUPABASE_ANON_KEY' }]),
    })
    const result = run(dir)
    expectRejected(result, 'VITE_SUPABASE_ANON_KEY')
    expect(result.output).toMatch(/reason/)
  })

  it('exits 1 for a blank reason, a malformed allowlist and a missing allowlist', () => {
    const blank = project({ '.github/public-env-allowlist.json': JSON.stringify([{ name: 'VITE_A_KEY', reason: '   ' }]) })
    expectRejected(run(blank), 'VITE_A_KEY', 'reason')
    const malformed = project({ '.github/public-env-allowlist.json': '{"name":"VITE_A_KEY"}' })
    expectRejected(run(malformed), 'public-env-allowlist.json')
    const dir = project()
    rmSync(join(dir, '.github'), { recursive: true, force: true })
    expectRejected(run(dir), 'public-env-allowlist.json')
  })

  it('does not let an allowlisted name excuse a different one', () => {
    const dir = project({
      '.env.example': 'VITE_SUPABASE_ANON_KEY=\nVITE_STRIPE_SECRET_KEY=\n',
      '.github/public-env-allowlist.json': JSON.stringify([{ name: 'VITE_SUPABASE_ANON_KEY', reason: 'public by design' }]),
    })
    const result = run(dir)
    expectRejected(result, 'VITE_STRIPE_SECRET_KEY')
    expect(result.output).not.toContain('VITE_SUPABASE_ANON_KEY')
  })
})
