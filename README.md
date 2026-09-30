# Blockchain Transaction Service Lab

A security-conscious backend lab for designing reliable blockchain transaction processing.

The project focuses on the engineering boundary between an API request and an on-chain confirmation:

`API request -> authentication -> idempotency -> state machine -> transaction processing -> confirmation -> reconciliation`

## Current capabilities

- Idempotency keys with conflict detection
- Explicit transaction lifecycle
- Exact decimal-string amount handling
- Internal transaction IDs separated from blockchain transaction hashes
- HTTP API with bearer-token authentication
- Request body size limits
- In-memory rate limiting
- Security response headers
- Health and readiness endpoints
- Graceful shutdown
- Non-root production container
- CI dependency audit and test execution
- Security and architecture documentation

## Transaction lifecycle

`CREATED -> SUBMITTED -> CONFIRMED`

A transaction can move to `FAILED` from `CREATED` or `SUBMITTED`.

Terminal states are not silently overwritten.

## Architecture

`Client/API -> Security Edge -> Transaction Service -> Queue -> Worker -> Blockchain/RPC -> Confirmation/Event Listener -> Reconciliation/Audit`

The current repository implements the API and core transaction service. Queue, worker, durable persistence, blockchain adapters, and reconciliation remain explicit production-hardening work.

See:

- `docs/ARCHITECTURE.md`
- `docs/SECURITY-ARCHITECTURE.md`
- `docs/API.md`
- `docs/OPERATIONS.md`

## Run locally

Set an API token:

```bash
# PowerShell
$env:API_TOKEN="change-me"
npm install
npm test
npm start
```

Health:

```
GET http://localhost:3000/health
```

Create a transaction:

```
POST /v1/transactions
Authorization: Bearer change-me
Idempotency-Key: withdrawal-123
Content-Type: application/json

{
  "from": "0xsender",
  "to": "0xreceiver",
  "amount": "1000000000000000"
}
```

## Security model

The project treats security as defense in depth:

1. Network firewall / security-group controls
2. TLS at the deployment edge
3. Authentication and authorization
4. Rate limiting
5. Request validation and body-size limits
6. Idempotent transaction handling
7. Explicit state transitions
8. Secret management outside Git
9. Audit/observability controls
10. CI security checks

A code repository cannot create the cloud/network firewall itself. Infrastructure-level firewall rules must be configured at deployment.

## Production-readiness status

This is a serious engineering lab, but it is not yet a production custody service.

Before real funds or production custody are considered, the service still needs durable PostgreSQL persistence, distributed idempotency constraints, a durable queue and workers, retry/backoff and dead-letter handling, RPC failover, nonce and fee management, confirmation-depth and reorg handling, on-chain reconciliation, centralized observability, secret management, TLS, network segmentation, backups, and a security review.

**Do not use this repository with real funds.**
