# Main Branch Protection Policy

## Required GitHub rules

Apply these controls to `main` with GitHub branch protection or a repository ruleset:

1. Require a pull request before merging.
2. Require at least 1 approving review.
3. Require review from CODEOWNERS.
4. Dismiss stale approvals when new commits are pushed.
5. Require all conversations to be resolved before merge.
6. Require the branch to be up to date before merge.
7. Block force pushes.
8. Block branch deletion.
9. Restrict direct pushes to `main`.
10. Apply the rules to administrators for normal production changes; avoid routine bypasses.
11. Prefer squash or rebase merges to keep the protected branch history reviewable.

## Required status checks

Use the exact successful check/job names produced by the current workflows:

- `Application and blockchain tests`
- `Security and contract validation`
- `CodeQL analysis`

The first two jobs currently cover syntax, application tests, Hardhat compile/tests, repository health, dependency audit, and container scanning where applicable.

## Repository-side controls already present

- `.github/CODEOWNERS` assigns ownership of the repository and security-sensitive paths.
- `.github/pull_request_template.md` requires validation and security review.
- CI, Security Checks, and CodeQL run on pushes and pull requests targeting `main`.
- GitHub Actions are pinned to immutable commit SHAs.
- Checkout uses `persist-credentials: false`.
- The repository health check validates required workflow/security structure.

## Current GitHub-side blocker

The connected GitHub integration reports repository admin permission, but the branch-protection administration endpoint returns HTTP 403 because the integration does not have the required administration scope. The available GitHub connector exposes ruleset reads, but no ruleset/branch-protection write operation.

Therefore the repository-side policy is documented, but the GitHub setting itself remains **not enabled** until applied through a GitHub session with repository administration access.

## Verification after applying

Confirm that:

- `main` displays as protected.
- Direct pushes to `main` are rejected.
- A pull request cannot merge while any required check is failing.
- CODEOWNERS review is enforced.
- Force pushes and branch deletion are blocked.
