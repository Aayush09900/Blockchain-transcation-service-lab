# Product Requirements Document (PRD)

## Product
Blockchain Transaction Service Lab

## Vision
Build a production-oriented backend service that safely manages blockchain transaction lifecycle state, idempotent requests, blockchain submission/confirmation, audit history, and receipt anchoring.

## Problem
Blockchain operations are asynchronous and can encounter duplicate requests, RPC failures, delayed confirmations, transaction replacement, and inconsistent application/audit state. The service provides a controlled lifecycle around these operations.

## Target users
- Backend/blockchain developers
- QA and security engineers
- Technical reviewers and recruiters

## Core features
1. Create a transaction request.
2. Prevent duplicate operations with idempotency.
3. Track transaction lifecycle.
4. Submit through a blockchain adapter.
5. Verify confirmations from blockchain receipts.
6. Persist an audit/read model.
7. Publish reliable outbox events.
8. Anchor receipt information on-chain.

## Lifecycle
CREATED -> BROADCASTING -> SUBMITTED -> CONFIRMED
CONFIRMED -> REORGED -> SUBMITTED -> CONFIRMED
CREATED -> FAILED
CREATED -> BROADCASTING -> FAILED
SUBMITTED -> FAILED

Ambiguous blockchain/RPC outcomes must be reconciled rather than automatically treated as failure.

## API
- GET /health
- GET /ready
- GET /metrics (authenticated Prometheus exposition)
- POST /v1/transactions
- POST /v1/transactions/:id/submit
- POST /v1/transactions/:id/confirm
- POST /v1/transactions/:id/fail
- POST /v1/transactions/:id/anchor
- GET /v1/transactions/:id/events

## Non-functional requirements
- MySQL is authoritative for application transaction state.
- MongoDB is a derived audit/read model.
- Idempotency must be database-enforced.
- Blockchain confirmation must be evidence-based.
- Secrets must never be committed or persisted.
- APIs require validation, authentication, authorization, rate limiting, secure headers, and safe errors.
- Correlation must connect requestId, transactionId, eventId, and txHash.
- Metrics must use normalized route and bounded categorical labels rather than transaction identifiers.
- CI must run tests, build, and security checks.

## Out of scope
Real-money custody, exchange/HFT functionality, KYC/AML, private-key custody, multi-chain settlement, and production financial certification.

## Success criteria
The repository demonstrates reliable transaction state management, blockchain integration, persistence, testing, security, Docker, CI/CD, and clear production boundaries.
