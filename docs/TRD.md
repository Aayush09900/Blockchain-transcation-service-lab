# Technical Requirements Document (TRD)

## Architecture

Client -> Node.js HTTP API -> middleware -> transaction service

Transaction service integrates with:
- MySQL for authoritative transaction state
- Blockchain adapter -> ethers.js -> Ethereum RPC
- MySQL outbox -> MongoDB audit/read model

## Layering
HTTP routes/controllers must not contain database or RPC implementation details.

Controller -> Service -> Repository
Service -> Blockchain Adapter
Outbox Worker -> MongoDB
Telemetry -> metrics and structured logs

## Current repository implementation
The repository currently uses a MySQL transactions table plus transaction_outbox rather than separate transaction_events, idempotency_keys, and outbox_events tables. This simpler model is retained unless a concrete requirement justifies migration.

## State machine
CREATED -> BROADCASTING -> SUBMITTED -> CONFIRMED
CONFIRMED -> REORGED -> SUBMITTED -> CONFIRMED
CREATED -> FAILED
CREATED -> BROADCASTING -> FAILED
SUBMITTED -> FAILED

Blockchain ambiguity is a reconciliation state/problem, not an automatic FAILED transition.

## Database requirements
- Unique transaction identifiers.
- Idempotency protection at database level.
- Row locking for lifecycle transitions.
- Transaction state changes and outbox creation in one MySQL transaction.
- Indexed transaction lookup fields.
- Append-oriented lifecycle/audit information.

## Blockchain requirements
- Validate configured chain ID.
- Use ethers.js through an adapter.
- The service controls blockchain broadcasting through the configured signer.
- Caller-supplied transaction hashes are rejected by the submission API.
- A submitted transaction hash is not proof of confirmation.
- Confirmation requires receipt verification and intent/payload verification.
- Broadcast timeouts and post-broadcast persistence failures must remain reconcilable.
- Blockchain broadcasts use an explicit gas ceiling and EIP-1559 max-fee/max-priority-fee ceilings in production.

## Security
JWT/bearer authentication, timing-safe credential comparison, validation, CORS allowlisting, secure headers, rate limiting, UUID validation, decimal-string amounts, safe errors, secret protection, dependency scanning, and CodeQL/security automation.

## Reliability
Transactional outbox, retry/lease processing, confirmation polling, reconciliation for uncertain blockchain state, structured logging, and operational metrics.

## Observability

- `/metrics` is authenticated.
- Metric labels use normalized routes and bounded outcome categories.
- Worker telemetry is structured and throttled.
- Centralized scraping and alerting remain deployment concerns.

## Deployment
Docker for local/integration environments. Production requires managed secrets, appropriate TLS/network controls, RPC redundancy, nonce/fee management, reorg handling, monitoring, backups, and disaster recovery.
