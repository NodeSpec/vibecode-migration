# Rulesets

`main.json` and `staging.json` are the source of truth for the rules on those two branches. They are reviewed like code and applied to GitHub by the repository owner with `gh api`.

No credential lives in this repository. The owner signs in to the GitHub CLI (`gh auth login`) and the token stays in the CLI's own store.

## Changing a rule

1. Change the JSON in a pull request and get it reviewed. Once `.github/CODEOWNERS` exists, the code owner must approve changes under `/.github/`.
2. After it merges, the owner applies it:
   - First time: `gh api --method POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json`
   - Afterwards: find the id with `gh api repos/{owner}/{repo}/rulesets --jq '.[] | {id,name}'`, then `gh api --method PUT repos/{owner}/{repo}/rulesets/<id> --input .github/rulesets/main.json`
3. Run the `rules-audit` workflow by hand (Actions → rules-audit → Run workflow). It reads the rules GitHub actually enforces and fails if they differ from these files.
4. Record the date and ruleset id in `docs/runbook.md`.

## Rules that must not drift

- The required check names `test`, `security-scan` and `promotion-source` are the job names in `.github/workflows/`. Renaming a job means changing both ruleset files in the same pull request, or every pull request waits forever on a check that never reports.
- `bypass_actors` stays empty. Break glass is the owner setting `"enforcement": "disabled"` for the shortest time possible and setting it back to `"active"` the same day, with the reason written in `docs/runbook.md`.
- Repository Settings → General → Pull Requests must keep "Allow merge commits" on, because a ruleset can only narrow the methods the repository allows.
