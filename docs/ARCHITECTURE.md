# Blockchain Transaction Service Lab Architecture

## 1. Scope

This repository is an engineering lab for a reliable blockchain transaction-processing backend. It demonstrates production-oriented boundaries without claiming that the repository alone is a production custody platform.

## 2. Current implemented architecture

Client/API
  |
  v
Security Edge
  |-- Authentication
  |-- Rate Limiting
  |-- Input Validation
  |-- Path Validation
  |-- CORS / Security Headers
  |
  v
Transaction Service
  |-- Idempotency
  |-- State Machine
  |
  v
PostgreSQL
  |-- Transactions
  |-- Idempotency Constraint
  |-- Audit Events

## 3. Planned transaction execution plane

Transaction Service
  |
  v
Durable Job Queue
  |
  v
Worker
  |-- Retry / Backoff / Dead Letter Queue
  |
  v
Blockchain RPC Adapter
  |
  v
Receipt / Confirmation Listener
  |
  v
Reconciliation

The queue/worker and live blockchain execution plane are intentionally separated from the core API and persistence layer.

## 4. Transaction lifecycle

CREATED -> SUBMITTED -> CONFIRMED
   |          |
   +--------> FAILED

Invalid transitions are rejected. Terminal states cannot be silently overwritten.

## 5. Data consistency

PostgreSQL provides:

- Unique idempotency key
- Parameterized SQL
- Transactional state changes
- Transaction event/audit records
- Row locking during state transitions
- Indexes for lifecycle and event access
- Unique transaction hash constraint when a hash exists

Concurrent idempotency requests use INSERT ... ON CONFLICT DO NOTHING followed by a locked read.

## 6. Security boundaries

- HTTPS/TLS should terminate at the deployment edge.
- Cloud firewall/security-group rules should expose only required ports.
- The database should remain on a private network.
- API authentication is required for protected endpoints.
- CORS is allowlist-based and disabled by default.
- Request bodies have a fixed upper bound.
- Transaction IDs are restricted to UUID format.
- Unexpected server errors are not returned verbatim.
- Secrets are loaded from environment or managed secret storage, not Git.
- Production database TLS defaults to enabled unless explicitly overridden.

## 7. Operational boundaries

Liveness:
GET /health

Readiness:
GET /ready

The readiness endpoint checks PostgreSQL when persistence is configured.

The server supports graceful shutdown for SIGTERM and SIGINT and returns an X-Request-ID for request tracing.

## 8. Production hardening still required

The following are explicit next-stage components:

- Durable queue and worker execution
- RPC failover
- Nonce management
- Fee/gas policy
- Confirmation depth
- Reorg handling
- Receipt validation
- Chain allowlisting
- Reconciliation scheduler
- Dead-letter queue
- Distributed rate limiting
- Centralized metrics, logging, and tracing
- Managed secrets
- TLS and cloud network policy
- Backups and restore testing
- Disaster recovery
- Independent security review
