# Runbook

The record of how this repository's deployment pipeline is set up. Every setting applied in GitHub's or Netlify's settings or API is written here with the date and who applied it.

Never write a key, token or password in this file.

## App contract

The app is "Split the bill", a Vite + React + TypeScript single-page app that already existed when the pipeline was added. Nothing was scaffolded, restructured or renamed: the audit below lists what the app already had and the few gaps that were closed. Audited 2026-10-16.

Publish folder: `dist`

| Contract item | Where it lives | Result |
|---|---|---|
| `lint` script | `package.json` runs `oxlint` | already there |
| `typecheck` script | `package.json` runs `tsc --noEmit` | already there |
| `test` script | `package.json` runs `vitest run` | already there; now limited to `src/**/*.test.{ts,tsx}` in `vite.config.ts` so the pipeline's own checks never run as the app's tests |
| `build` script | `package.json` runs `tsc -b && vite build` | already there |
| Publish folder | `dist/` (Vite default), listed in `.gitignore` | already there; recorded above |
| Node.js version | `.nvmrc` holds `22` | already there |
| Lockfile | `package-lock.json` is committed and `npm ci` installs from it | already there |
| Production source maps | `build.sourcemap: false` in `vite.config.ts` | added; it was the Vite default, now it is stated |
| `.env.example` | public `VITE_` values only, with a header saying secrets never go here | added |
| Secrets in browser code | no `VITE_` or `NEXT_PUBLIC_` variable is declared anywhere in the repository | none found |
| `/api/health` | the Health Check node | not built yet |

### Each script fails when it should

Run on 2026-10-16 from a clean checkout. For each script one deliberate fault was added, the exit code recorded, and the fault removed again. All four scripts passed again afterwards.

| Script | Deliberate fault | Exit code |
|---|---|---|
| `npm run lint` | a Hook called conditionally (`react/rules-of-hooks`) | 1 |
| `npm run typecheck` | a string assigned to a number | 2 |
| `npm test` | an assertion `expect(1).toBe(2)` | 1 |
| `npm run build` | an import of a module that does not exist | 1 |

From a clean install (`npm ci`), `npm run build` wrote one folder, `dist/`, holding `index.html` and `assets/`, with no `.map` files.

## GitHub Repository

| Item | Value |
|---|---|
| Repository | `NodeSpec/vibecode-migration` |
| Visibility | public (read from GitHub on 2026-10-16) |
| GitHub plan | not needed while the repository is public, because rulesets are enforced on public repositories. If it is ever made private it needs GitHub Pro (personal) or Team (organization) |
| Default branch | `main` |
| Branches | `main` and `staging`. On 2026-10-16 `staging` existed and pointed at the same commit as `main` |
| Netlify site | not recorded yet (Netlify node) |

### Settings applied

Nothing has been applied by the pipeline work yet. The rows below are filled in by the owner as each setting is applied.

| Setting | Value | Date | Applied by |
|---|---|---|---|
| `staging` branch | exists, created before this runbook | not recorded | not recorded |
| `main` ruleset | not applied | | |
| `staging` ruleset | not applied | | |
| Allow merge commits | to confirm in Settings → General → Pull Requests | | |
| Default workflow token read-only; Actions may not approve pull requests | not applied | | |
| Outside-contributor workflows need approval | not applied | | |
| Agent identity (Write role, no admin, no bypass) | not set up | | |

State of the rules on 2026-10-16, read from `GET /repos/NodeSpec/vibecode-migration/rules/branches/main` and `.../staging`: both returned an empty list, so no rules are enforced on either branch yet.

### What `rules-audit` reads (contract with CI Pipeline)

- Endpoints: `GET /repos/{owner}/{repo}/rules/branches/main` and `GET /repos/{owner}/{repo}/rules/branches/staging`, plus `GET /repos/{owner}/{repo}/codeowners/errors`.
- Credential: the workflow's own `GITHUB_TOKEN` at `contents: read`. There is no extra secret and nothing to rotate.
- Expected state: `.github/rulesets/main.json` and `.github/rulesets/staging.json`. The CI Pipeline node owns the script that compares them (`scripts/ci/rules-audit.mjs`); this node owns the expected values.
- Expected rule types, both branches: `deletion`, `non_fast_forward`, `pull_request` (`require_code_owner_review` true, `dismiss_stale_reviews_on_push` true) and `required_status_checks`.
- `main`: `allowed_merge_methods` is `["merge"]`; required checks `test`, `security-scan`, `promotion-source`.
- `staging`: `required_approving_review_count` is 1; required checks `test`, `security-scan`.

### Owner checklist

Steps only the repository owner can do. The pipeline work cannot confirm that any of them took effect, so each one ends with a way to find out.

- [ ] Sign in to the GitHub CLI as the owner: `gh auth login`, then `gh auth status`. Never paste the token anywhere.
- [ ] Confirm Settings → General → Pull Requests keeps "Allow merge commits" on.
- [ ] Run the `history-scan` workflow once and rotate anything it finds, before any rule switches on (REQ-019).
- [ ] Give the coding agent its own GitHub account or GitHub App with the Write role, no admin permission and no ruleset bypass (REQ-003).
- [ ] Tell the agent your GitHub username and the folders that must not change without your approval, so `.github/CODEOWNERS` can be written (REQ-004).
- [ ] After the CI workflows have run once on a pull request: apply the `staging` ruleset, then the `main` ruleset, and run `rules-audit` by hand after each.
- [ ] Settings → Actions → General: default workflow token read-only, untick "Allow GitHub Actions to create and approve pull requests", require approval for outside contributors' workflows (REQ-016).
- [ ] Run the two rehearsals: the failing-test pull request into `staging`, and a pull request straight into `main`.
