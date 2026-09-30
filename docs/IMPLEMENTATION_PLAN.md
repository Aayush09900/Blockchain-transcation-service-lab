# Implementation Plan

## Phase 0 — Repository audit
Completed: inspect current source, schema, workers, contract, tests, Docker, and CI. Record gaps before core changes.

## Phase 1 — Documentation synchronization
Add PRD, TRD, APP FLOW, UI/UX, BACKEND SCHEMA, and IMPLEMENTATION PLAN to the repository. Keep documentation aligned with actual implementation rather than forcing unnecessary abstractions.

## Phase 2 — Reproducible dependencies
Add package-lock.json and use npm ci in CI/container builds where appropriate.

## Phase 3 — Verified submission
Completed: normal submission is service-controlled; caller-supplied hashes are rejected on `/submit` and supported only by verified reconciliation.

## Phase 4 — Unknown-result reconciliation
Completed: ambiguous broadcast errors remain `BROADCASTING`; worker/event recovery and the reconciliation endpoint provide a safe recovery path.

## Phase 5 — Atomic outbox claiming
Completed: MySQL `FOR UPDATE SKIP LOCKED` claims events with a lease token and expiry.

## Phase 6 — Confirmation tests
Completed: submission/reconciliation unit coverage, blockchain intent validation coverage, and MySQL lifecycle/outbox lease integration coverage are in place.

## Phase 7 — Security regression
Run validation, authentication, authorization, rate-limit, CORS, secret, dependency, and CodeQL checks.

## Phase 8 — Observability
Add structured logs, correlation IDs, outbox lag, RPC errors, confirmation latency, and worker health metrics.

## Phase 9 — Docker/CI
Validate reproducible builds, contract tests, application tests, security checks, and container startup.

## Phase 10 — Deployment
Validate staging first. Production requires managed secrets, RPC redundancy, nonce/fee management, reorg handling, reconciliation, backups, disaster recovery, and operational alerting.

## Definition of done
Requirement -> implementation -> tests -> security review -> documentation -> CI -> meaningful Git commit.

## Production boundary
This lab demonstrates production-oriented engineering patterns but is not a certification for real-money custody or financial settlement.
