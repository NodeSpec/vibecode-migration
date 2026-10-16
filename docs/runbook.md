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

## CI Pipeline

Five workflows in `.github/workflows/`. CI decides what may merge and proves each deploy behaves; it never deploys, because Netlify builds and publishes from Git on its own.

| Workflow | Job (the check name) | Runs | What it does |
|---|---|---|---|
| `ci.yml` | `test` | every pull request into `staging` or `main` | `npm ci`, `lint`, `typecheck`, `npm test`, `build`, then `npm run test:pipeline` |
| `security.yml` | `security-scan` | every pull request into `staging` or `main` | Trivy over the repository (vulnerable packages, committed secrets, misconfiguration; CRITICAL and HIGH fail), then `check-public-env`, then a Trivy secret scan of the built `dist/` |
| `promotion.yml` | `promotion-source` | every pull request into `main` | fails unless the pull request comes from the `staging` branch of this repository (a branch called `staging` in a fork fails too) |
| `smoke.yml` | `smoke` | after a successful Netlify deploy | calls `GET /api/health` on the deployed URL and checks it against the contract |
| `rules-audit.yml` | `rules-audit` | weekly, and by hand | compares the rules GitHub enforces with `.github/rulesets/*.json` |

The three check names `test`, `security-scan` and `promotion-source` are an interface: the rulesets require exactly those names, and `npm run test:pipeline` fails if a job is renamed, put in a matrix, or a ruleset requires a check no job provides.

### Pinned actions

Every third-party action is pinned to a full commit SHA, with the version in a trailing comment. Looked up on 2026-10-16 with `git ls-remote --tags` on each action's own repository, then checked to be a commit on the repository's default branch (no dangling commit behind a moved tag).

| Action | Version | Commit | Commit date |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-17 |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 2026-10-07 |
| `aquasecurity/trivy-action` | v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | 2026-04-22 |

`trivy-action` v0.36.0 is an annotated tag: the tag object is `a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8` and the pin is the commit it points at. Its commit is dated after the March 2026 incident in which attackers repointed nearly all of its version tags. A pin protects against a moved tag; it does not vouch for the code at that commit, so the code owner reviews every pin change, including Dependabot's.

Dependabot proposes weekly updates for `github-actions` and `npm`, as pull requests into `staging`.

### Checks that need a real run

- **Trivy has not run yet.** The first scan's findings on this repository are not known until `security-scan` runs on a pull request. Fix what an upgrade fixes, and list the rest in `.trivyignore` with a reason, owner and review date, before `security-scan` becomes a required check.
- **Deploy environment names.** `smoke.yml` logs the environment name GitHub receives from Netlify on every run. `scripts/ci/smoke-health.mjs` treats a name starting with "Production" as production and expects live payments there and test payments everywhere else. After the first deploy, check the log and fix `isProduction()` if Netlify names it differently.
- **`smoke.yml` concurrency** is keyed by deployment id, not by branch, so a status event for another deploy of the same branch cannot cancel a running check.

### rules-audit

Run it by hand right after applying a ruleset (Actions → rules-audit → Run workflow). That run is the evidence for the rules-API test cases. It fails closed: an API error, an empty rule list or any mismatch is a failure.

On 2026-10-16 it was run from outside GitHub Actions against this repository and failed as it should: no active rules on `staging` or `main`, and no CODEOWNERS file.

### Running the pipeline checks locally

`npm run build && npm run test:pipeline`. The contract check wants `dist/index.html`, so build first.

## Health Check

`GET /api/health` is pipeline instrumentation, not an app feature. It lives in `netlify/functions/health.ts`, is routed by the `/api/*` redirect in `netlify.toml`, and exists so `smoke.yml` can prove, after every deploy, which payment key that deploy holds.

It answers `200` with `{ status, deployContext, paymentsMode, branch, commitRef }` (the contract is `netlify/functions/_lib/health.schema.json`), `Content-Type: application/json` and `Cache-Control: no-store`, and never a key or a stack trace.

- `paymentsMode` comes from the prefix of `PAYMENT_SECRET_KEY`: `sk_test_` is `test`, `sk_live_` is `live`. A missing or unrecognised key is a `500` with `{ error: "payment_key_missing", correlationId }`.
- `deployContext` comes from Netlify's `context.deploy.context` at runtime. Netlify's build variables do not exist when a function runs.
- `branch` and `commitRef` are written at build time by `scripts/write-build-info.mjs` (the `postbuild` script) into `netlify/functions/_lib/build-info.json`, which git ignores. Each deploy carries its own, so a rolled-back deploy reports its own commit, and that is how a rollback is confirmed.
- Every error is `{ error, correlationId }` with a fixed code (`request_failed`, `invalid_request`, `method_not_allowed`, `payment_key_missing`). The log line carries only the correlation id and the error's name.
- Anything but `GET` is `405`; a query string or a body is `400`. There is no CORS header.

Production must report `live` and every other deploy `test`. A preview or staging deploy that reports `live` fails `smoke.yml` loudly. That is the whole point.

## Netlify

`netlify.toml` at the repository root is the provisioning definition. There is no separate IaC tool. Netlify applies it over the site settings in its UI, so a change goes through pull-request review. It holds the build command (`npm ci && npm run build`, so installs come from the lockfile), `publish = "dist"`, `functions = "netlify/functions"`, `NODE_VERSION = "22"` (the same as `.nvmrc`), the `/api/*` redirect to the functions and, as the last rule, the single-page-app fallback to `/index.html`. It holds public values only.

None of the settings below has been recorded yet. If the site already exists, the owner fills in each row (date and who set it) from what the dashboard shows, and corrects any setting that differs.

### Netlify settings

Settings that `netlify.toml` cannot hold, set in Netlify's dashboard by the owner. Record the key name, never a value.

| Setting | Value to set | Date | Set by |
|---|---|---|---|
| Site | imported from the GitHub repository `NodeSpec/vibecode-migration` (never drag and drop a folder: that has no deploy contexts and no previews) | | |
| Site name | | | |
| Production branch | `main` | | |
| Branch deploys | "Let me add individual branches", `staging` only (never All branches, or every agent branch publishes a public site) | | |
| Deploy Previews | on for pull requests into `staging` and `main` | | |
| Staging URL | `https://staging--<site>.netlify.app` | | |
| `PAYMENT_SECRET_KEY` | "Contains secret values" ticked, scope Functions where the plan offers it, a different value for each deploy context: an `sk_live_` placeholder for Production, an `sk_test_` placeholder for Deploy Previews, another `sk_test_` placeholder for Branch: staging | | |
| `SECRETS_SCAN_ENABLED` | not set. It must never be `false`, here or in `netlify.toml` | | |
| Auto publishing | unlocked, except during a rollback (see below) | | |

Placeholder values are generated on the owner's own machine (for example `openssl rand -hex 12` appended to `sk_live_placeholder_` or `sk_test_placeholder_`) and are never committed, logged or pasted into chat. A real payment provider's keys later replace them in the same slots, set the same way.

### Rollback

1. Netlify → Deploys → open the previous successful production deploy → **Publish deploy**.
2. Immediately, Deploys → **Lock to stop auto publishing**. A new Git-triggered production deploy would otherwise overwrite the rollback.
3. Fix the problem on a branch and merge it through `staging` to `main`.
4. Only once the fix has merged through staging and its production deploy is ready, unlock auto publishing.
5. Confirm the rollback against `GET /api/health`: `commitRef` is the commit of the deploy that was restored.

Rehearsed: not yet. Once production is live, ship a harmless visible change (for example a footer text) through staging to production, roll back, confirm the change is gone and `commitRef` matches the previous deploy, then unlock. Record the date and the result here.
