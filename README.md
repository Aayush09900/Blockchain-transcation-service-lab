# Blockchain Transaction Service Lab

A security-conscious backend engineering lab for reliable blockchain transaction processing.

The project focuses on the boundary between an API request and an on-chain confirmation:

`API request -> security edge -> idempotency -> state machine -> persistence -> worker -> blockchain/RPC -> confirmation -> reconciliation`

## Current capabilities

- Idempotency keys with conflict detection
- Canonical exact-string transaction amounts
- Explicit transaction lifecycle and invalid-transition protection
- PostgreSQL persistence with transactional writes
- Transaction event/audit records
- HTTP API with bearer-token authentication
- Request ID propagation
- Strict transaction-path UUID validation
- Request body limits and JSON content-type validation
- Bounded in-memory rate limiting
- Security response headers and CORS allowlisting
- Health and readiness endpoints
- Graceful shutdown
- Non-root production container
- Docker Compose PostgreSQL development stack
- CI unit tests and PostgreSQL integration tests
- Dependency audit
- Repository structure and secret health checks
- Security vulnerability regression suite
- Architecture, API, operations, and security documentation

## Project structure

```
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── security.yml
├── db/
│   └── 001_init.sql
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── OPERATIONS.md
│   └── SECURITY-ARCHITECTURE.md
├── scripts/
│   └── repo-health-check.js
├── src/
│   ├── config.js
│   ├── http-errors.js
│   ├── http-server.js
│   ├── path-security.js
│   ├── postgres-store.js
│   ├── security.js
│   ├── transaction-service.js
│   └── validation.js
├── test/
│   ├── config.test.js
│   ├── postgres-store.integration.test.js
│   ├── security-vulnerabilities.test.js
│   └── transaction-service.test.js
├── Dockerfile
├── docker-compose.yml
├── package.json
├── SECURITY-TEST-REPORT.md
└── SECURITY.md
```

## Transaction lifecycle

`CREATED -> SUBMITTED -> CONFIRMED`

A transaction can move to `FAILED` from `CREATED` or `SUBMITTED`.

Terminal states are protected from invalid rewrites.

## System architecture

```
Client/API
   |
   v
Security Edge
   |
   +--> Authentication
   +--> Rate Limiting
   +--> Input Validation
   +--> Path Validation
   |
   v
Transaction Service
   |
   +--> Idempotency
   +--> State Machine
   |
   v
PostgreSQL
   |
   +--> Transactions
   +--> Idempotency Constraint
   +--> Transaction Events / Audit
   |
   v
Queue / Worker boundary
   |
   v
Blockchain / RPC
   |
   v
Confirmation / Event Listener
   |
   v
Reconciliation / Monitoring
```

The repository currently implements the security edge, transaction service, PostgreSQL persistence, and test/CI layers. Queue/worker execution, live blockchain submission, confirmation monitoring, and reconciliation remain separate production components to implement and operate.

## Run locally

### Core tests

```bash
npm install
npm test
npm run verify
```

### Development server

PowerShell:

```powershell
$env:NODE_ENV="development"
$env:API_TOKEN="change-me"
npm start
```

### Local PostgreSQL stack

Copy `.env.example` to `.env`, replace the placeholder credentials, then:

```bash
docker compose up --build
```

The API is intentionally bound to `127.0.0.1:3000` by the compose file.

### Health

```
GET http://localhost:3000/health
GET http://localhost:3000/ready
```

### Create a transaction

```
POST /v1/transactions
Authorization: Bearer <API_TOKEN>
Idempotency-Key: withdrawal-123
Content-Type: application/json

{
  "from": "0xsender",
  "to": "0xreceiver",
  "amount": "1000000000000000"
}
```

## Security model

The project uses defense in depth:

1. Network firewall or cloud security group
2. TLS at the deployment edge
3. Authentication
4. Rate limiting
5. Request validation
6. Strict path validation
7. Idempotency
8. Explicit state transitions
9. PostgreSQL transactional persistence
10. Secret management outside source control
11. Audit events and request IDs
12. CI security validation

The application does not pretend to be a network firewall. Infrastructure firewall rules, private subnets, TLS termination, and secret-manager integration belong to the deployment environment.

## Security testing

Run:

```bash
npm test
```

Security regression coverage includes path traversal probes, malformed URL encoding, authentication boundaries, rate-limit pressure, security headers, configuration invariants, and internal error disclosure.

See:

`SECURITY-TEST-REPORT.md`

## Production readiness

This repository is now a production-oriented engineering foundation, but it is not presented as a production custody service.

Before handling real funds, the following must still be implemented and independently reviewed:

- Durable queue and worker processing
- Retry/backoff and dead-letter handling
- Blockchain RPC failover
- Nonce and fee management
- Chain allowlisting
- Confirmation-depth and reorg handling
- On-chain receipt verification
- Reconciliation jobs
- Distributed rate limiting
- Centralized metrics, tracing, and logs
- Managed secrets
- TLS and cloud firewall configuration
- Backup and restore testing
- Disaster-recovery procedures
- Independent security review

Do not connect this repository to real funds or production custody without these controls and appropriate operational review.
