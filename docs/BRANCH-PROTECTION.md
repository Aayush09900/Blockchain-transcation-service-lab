# Protecting the main branch

The repository currently has an unprotected main branch.

For a production repository, configure branch protection/rules in GitHub so that:

1. Direct force-push and branch deletion are blocked.
2. Pull requests are required before changes reach main.
3. Required CI/security checks must pass before merge.
4. The latest branch must be up to date before merge when your workflow requires it.
5. Code-owner review is required for security-sensitive paths when supported by your repository settings.
6. Administrators follow the same review rules for normal production changes where practical.

Recommended required checks from this repository are the successful Transaction Service CI and Security Checks workflows. Keep CodeQL enabled as an additional GitHub security check.

## Why this is not automated here

The current GitHub connection can read repository/workflow data but does not have the administration permission required to modify branch-protection settings. No fake protection state is claimed.

After enabling the rules in GitHub, verify the warning on the repository's main branch disappears and that a test pull request cannot merge while a required status check is failing.

## Code ownership

.github/CODEOWNERS assigns the repository owner as the default code owner and explicitly covers the security, blockchain, workflow, and contract directories.
