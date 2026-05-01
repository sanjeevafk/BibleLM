# bibleLM Security Monitoring Suite

Security tooling for bibleLM project-level controls (dependency and code scanning).

## Scripts

### `security-check.sh`
Runs a project security audit focused on:
- npm vulnerability summary (critical/high fail)
- lockfile presence
- hardcoded secret heuristics
- risky code pattern heuristics (`eval`, process execution, dynamic SQL patterns)
- git/config/exposure checks
- filesystem permission checks

Run:
```bash
bash scripts/security/security-check.sh
```

Exit behavior:
- `0`: no critical failures (warnings may exist)
- `1`: one or more failures

### `supply-chain-check.sh`
Runs dependency and supply-chain focused checks:
- npm audit severity breakdown
- optional Snyk test (if installed)
- lockfile integrity metadata checks
- package source and naming heuristics
- install lifecycle-script presence in direct dependencies
- transitive tree size estimation

Run:
```bash
bash scripts/security/supply-chain-check.sh
```

Exit behavior:
- `0`: no failures (warnings allowed)
- `1`: critical supply-chain issues found

### Local-only system setup
System-wide setup script is intentionally **not version-controlled** in this repository.

Local path:
```bash
/home/sanjeev/Downloads/security-local/setup-system-monitoring.sh
```

Use it only on trusted local machines where you want OS-level monitoring.

## Quick Start

```bash
find scripts/security -name "*.sh" -type f -exec chmod +x {} \;
bash scripts/security/project/check-integrity.sh init
bash scripts/security/security-check.sh
bash scripts/security/supply-chain-check.sh
```

## Operational Notes

- These checks are heuristic and intentionally conservative; warnings require human review.
- Paths in generated system configs are anchored to your current project root at setup time.
- Re-run setup when repository path changes, or when you want to refresh audit/AIDE configs.
- For CI, run both check scripts and fail the pipeline on non-zero exit.

## Recommended Automation

- Pre-commit: already wired for dependency file changes.
- CI: run on pull requests touching `package.json`, lockfiles, or security scripts.
- Scheduled: run `scripts/security/security-check.sh` and `scripts/security/supply-chain-check.sh` from cron/CI as needed.
