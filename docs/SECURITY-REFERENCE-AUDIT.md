# Security Reference Audit

The uploaded security-oriented reference repository was extracted and reviewed.

## Useful controls adopted for this transaction service

The reference project reinforces several controls already present here:
- parameterized SQL instead of string-built SQL
- safe database error messages
- validation at trust boundaries
- bounded rate limiting
- explicit authentication
- secret-safe logging
- dependency and CI security
- production security configuration
- security-focused tests

## Controls added in this pass

- The Security Checks workflow runs `npm audit --audit-level=high` on pushes and pull requests. GitHub Dependency Review was evaluated separately but is not enabled because the repository's Dependency Graph is not currently available through the connected GitHub integration.
- CodeQL analysis for JavaScript/TypeScript on pushes, pull requests, and weekly scheduled runs.
- Both workflows use immutable commit references.
- Dependency installation is already reproducible with the committed npm lockfile and npm ci.

## Controls intentionally not copied

The reference SQL regex blacklist is not used here because this service already uses mysql2 parameterized queries. Regex blacklists are not a substitute for parameterized database access.

The reference devcontainer firewall is not copied into the runtime. This service uses Docker network isolation and container hardening instead.

## Remaining transaction-service security work

- reorg handling
- distributed rate limiting
- cross-instance nonce coordination
- durable reconciliation beyond the bounded broadcast event lookback
- managed secret storage
- monitoring and disaster recovery
- independent security review

This file records security reuse from the supplied reference; it does not certify the project for real-money settlement.
