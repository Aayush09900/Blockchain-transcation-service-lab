# Implementation Plan

## Phase 0 — Repository audit
Completed: inspect current source, schema, workers, contract, tests, Docker, and CI. Record gaps before core changes.

## Phase 1 — Documentation synchronization
Add PRD, TRD, APP FLOW, UI/UX, BACKEND SCHEMA, and IMPLEMENTATION PLAN to the repository. Keep documentation aligned with actual implementation rather than forcing unnecessary abstractions.

## Phase 2 — Reproducible dependencies
Add package-lock.json and use npm ci in CI/container builds where appropriate.

## Phase 3 — Verified submission
Completed: `POST /submit` uses the service-controlled blockchain adapter and signer. Caller-supplied transaction hashes are rejected. Repeated submission is idempotent.

## Phase 4 — Unknown-result reconciliation
Completed: broadcast and post-broadcast persistence ambiguity leave the transaction in `BROADCASTING`. The confirmation worker recovers mined broadcasts from indexed anchor events and verifies the recovered intent before continuing.

## Phase 5 — Atomic outbox claiming
Completed: MySQL outbox rows use worker ownership leases, `FOR UPDATE SKIP LOCKED`, expiry recovery, and ownership checks before finalization.

## Phase 6 — Confirmation tests
Completed: receipt verification regression coverage now includes pending receipts, successful receipts, reverted receipts, RPC failures, repeated verification, and payload mismatch protection. State-machine tests cover terminal-state protection.

## Phase 7 — Security regression
Implemented; final candidate status is gated by application, Hardhat, repository-health, dependency-audit, CodeQL, and container validation checks.

## Phase 8 — Observability
Implemented: authenticated Prometheus-format metrics, low-cardinality HTTP telemetry, outbox lag telemetry, broadcast/verification outcomes, reorg/recovery counters, confirmation evidence, and throttled worker heartbeats.

## Phase 9 — Docker/CI
CI gates are implemented for reproducible installs, syntax, application tests, Hardhat compile/tests, repository health, dependency audit, container build, and HIGH/CRITICAL image scanning.

## Phase 10 — Deployment
Validate staging first. Production requires managed secrets, RPC redundancy, nonce/fee management, reorg handling, reconciliation, backups, disaster recovery, and operational alerting.

## Phase 11 — Durable stale-broadcast reconciliation
Completed: stale `BROADCASTING` transactions now receive an idempotent durable reconciliation-required signal after a configurable age threshold. Unknown blockchain outcomes remain non-terminal and are never automatically retried. Integration coverage verifies stale detection, idempotence, and clearing after successful recovery.

## Definition of done
Requirement -> implementation -> tests -> security review -> documentation -> CI -> meaningful Git commit.

## Production boundary
This lab demonstrates production-oriented engineering patterns but is not a certification for real-money custody or financial settlement.
