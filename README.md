# Blockchain Transaction Service Lab

A production-oriented backend engineering lab for reliable blockchain transaction processing.

The design separates four concerns:

1. MySQL for authoritative transaction state and idempotency.
2. MongoDB for an audit/event read model.
3. ethers.js for controlled Ethereum interaction.
4. Hardhat 3 for contract and blockchain integration testing.

The core flow is:

`API -> security edge -> MySQL transaction state -> MySQL outbox -> MongoDB audit -> ethers.js -> Ethereum`

## Technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| API | Node.js HTTP | Request handling |
| Primary database | MySQL 8.4 | Transactions, idempotency, outbox |
| Audit/read model | MongoDB | Transaction events and snapshots |
| Blockchain SDK | ethers.js 6.17 | RPC, wallet, contract interaction |
| Blockchain testing | Hardhat 3.18 | Local Ethereum simulation and contract tests |
| Contract | Solidity 0.8.28 | On-chain receipt anchoring |
| Runtime | Docker | Repeatable deployment |
| CI | GitHub Actions | Tests, security, container build |

MySQL2 supports pooled connections, prepared statements, Promise APIs and SSL, which fits the transaction-state workload. citeturn933955search0turn933955search2 MongoDB is used as an audit/read model rather than the financial source of truth; its Node driver supports idempotent writes and ACID transactions when needed. citeturn849922search0turn849922search4 ethers.js provides JSON-RPC providers and contract interaction, and Hardhat 3 provides both Solidity and TypeScript/JavaScript testing workflows. citeturn893206search0turn590372search1

## Repository structure

```
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── security.yml
│       └── publish-image.yml
├── contracts/
│   └── TransactionReceiptAnchor.sol
├── db/
│   └── mysql/
│       └── 001_init.sql
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── OPERATIONS.md
│   └── SECURITY-ARCHITECTURE.md
├── scripts/
│   └── repo-health-check.js
├── src/
│   ├── blockchain-adapter.js
│   ├── blockchain-submission-service.js
│   ├── config.js
│   ├── http-errors.js
│   ├── http-server.js
│   ├── mongo-audit-store.js
│   ├── mysql-store.js
│   ├── outbox-worker.js
│   ├── path-security.js
│   ├── security.js
│   ├── transaction-service.js
│   └── validation.js
├── hardhat-tests/
│   └── TransactionReceiptAnchor.test.js
├── test/
│   ├── config.test.js
│   ├── mongo-audit-store.integration.test.js
│   ├── mysql-store.integration.test.js
│   ├── security-vulnerabilities.test.js
│   ├── blockchain-adapter.test.js
│   ├── blockchain-submission-service.test.js
│   └── transaction-service.test.js
├── Dockerfile
├── docker-compose.yml
├── hardhat.config.js
├── package.json
├── README.md
├── SECURITY.md
└── SECURITY-TEST-REPORT.md
```

## Architecture documents

The implementation documents maintained in `docs/` are:

- [Architecture](./docs/ARCHITECTURE.md)
- [API](./docs/API.md)
- [Operations](./docs/OPERATIONS.md)
- [Security Architecture](./docs/SECURITY-ARCHITECTURE.md)
- [OpenAPI](./docs/openapi.yaml)
- [Railway Deployment](./docs/RAILWAY-DEPLOYMENT.md)

## Transaction lifecycle

The current implementation supports:

`CREATED -> BROADCASTING -> SUBMITTED -> CONFIRMED`

A transaction may move to `FAILED` from `CREATED`, `BROADCASTING`, or `SUBMITTED`.

The `BROADCASTING` state represents an in-progress blockchain broadcast operation. A transaction hash is evidence of submission, not confirmation.

## Current persistence model

The current MySQL schema intentionally uses:

- `transactions` as the authoritative transaction/state table.
- `transaction_outbox` as the durable event-delivery mechanism.
- A unique `idempotency_key` on `transactions` for request deduplication.

MongoDB is a derived audit/read model, not the source of truth.

## System architecture

```
                         Client
                           |
                           v
                 +-------------------+
                 |    Security Edge  |
                 | Auth / Rate Limit |
                 | Validation / CORS|
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Transaction API   |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 |      MySQL        |
                 | Source of Truth   |
                 | Idempotency       |
                 | Transaction State |
                 | Outbox            |
                 +---------+---------+
                           |
                +----------+----------+
                |                     |
                v                     v
        +---------------+     +---------------+
        | Outbox Worker |     | Transaction   |
        | Retry/Publish |     | API Read Path |
        +-------+-------+     +---------------+
                |
                v
        +---------------+
        |   MongoDB     |
        | Audit/Event   |
        | Read Model    |
        +---------------+

Blockchain execution path:

MySQL transaction
      |
      v
ethers.js adapter
      |
      v
Ethereum RPC
      |
      v
TransactionReceiptAnchor.sol
      |
      v
receipt / tx hash
      |
      v
MySQL state + outbox event
```

The financial/transaction state remains in MySQL. MongoDB is deliberately not the source of truth. The MySQL outbox provides a reliable handoff to the MongoDB audit model. The ethers.js adapter is isolated from HTTP and database code.

### Retry policy

Transient failures can be retried only when the failure is explicitly marked retryable. Retries reuse the original transaction and idempotency key, use bounded exponential backoff (1s, 2s, 4s, capped at 30s), and stop after three retry attempts. Verified blockchain reverts and other non-retryable failures remain terminal.

## Local development

### 1. Install

```bash
npm install
```

### 2. Start infrastructure

Copy `.env.example` to `.env`, replace the placeholder credentials, then:

```bash
docker compose up --build
```

The API is bound to `127.0.0.1:3000`.

### 3. Run application tests

```bash
npm test
```

### 4. Run Hardhat tests

```bash
npm run test:hardhat
```

### 5. Run all validation

```bash
npm run chain:compile
npm test
npm run test:hardhat:ci
npm run verify
```

## API

### Health

```
GET /health
```

### Readiness

```
GET /ready
```

### Metrics

```
GET /metrics
Authorization: Bearer <API_TOKEN>
```

The endpoint returns Prometheus-compatible application metrics. Route labels use normalized templates to avoid transaction-ID cardinality. It is intended for an authenticated scraper or gateway; dashboards and alert rules remain deployment responsibilities.

### Create transaction

```
POST /v1/transactions
Authorization: Bearer <API_TOKEN>
Idempotency-Key: withdrawal-123
Content-Type: application/json

{
  "from": "0xsender",
  "to": "0xreceiver",
  "amount": "0.001"
}
```

### Submit

```
POST /v1/transactions/:id/submit
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{}
```

The service moves the transaction to `BROADCASTING`, broadcasts the configured on-chain anchor through its signer, then stores the returned transaction hash as `SUBMITTED`. Callers cannot provide an arbitrary transaction hash.

A repeated submit is idempotent: once execution has started, the current authoritative state is returned. If the RPC or database outcome becomes ambiguous after broadcast, the transaction remains `BROADCASTING` and the confirmation worker reconciles it from the indexed on-chain anchor event.


### Confirm

```
POST /v1/transactions/:id/confirm
Authorization: Bearer <API_TOKEN>
```

### Fail

```
POST /v1/transactions/:id/fail
Authorization: Bearer <API_TOKEN>

{
  "reason": "RPC timeout"
}
```

### On-chain anchor

When the ethers.js adapter is enabled:

```
POST /v1/transactions/:id/anchor
Authorization: Bearer <API_TOKEN>
```

This broadcasts an on-chain receipt anchor and returns HTTP 202 with the transaction hash. The confirmation worker later verifies the mined transaction before the record reaches CONFIRMED. It is not a custody or user-fund transfer function.

### Audit events

```
GET /v1/transactions/:id/events
Authorization: Bearer <API_TOKEN>
```

## Security model

The application uses layered controls:

- Authentication boundary
- Bounded rate limiting
- Strict JSON/body validation
- UUID-only transaction paths
- Exact decimal-string handling
- Idempotency enforcement
- MySQL row-level transaction locking
- MySQL unique constraints
- MySQL outbox
- MongoDB majority writes
- ethers.js chain ID validation
- Multi-RPC failover through ethers.js FallbackProvider
- Process-local nonce serialization through ethers.js NonceManager
- Production secret validation
- Security headers and CORS allowlisting
- CI dependency audit
- Hardhat contract tests
- Repository secret scanning
- Authenticated operational metrics
- Structured worker telemetry and event-lag reporting

Infrastructure firewall rules, TLS certificates, private subnets, managed secrets, backups and alerting must be configured at the deployment platform.

## Production boundary

The repository is now structured as a production-oriented transaction service, but production custody requires additional operational controls:

- durable job queue and workers
- RPC failover across independently configured RPC endpoints
- nonce management within a single signer process
- fee policy
- chain allowlisting
- receipt/confirmation depth
- reorg handling
- reconciliation
- distributed rate limiting
- metrics, tracing and alerting
- managed secret storage
- database backups and tested restore
- disaster recovery
- independent security review

Do not connect this lab to real funds until these controls are implemented and reviewed.


## Live project dashboard

The project now includes a GitHub Pages dashboard with the architecture, technology stack, deployment notes, and repository links.

**Live dashboard:** https://aayush09900.github.io/Blockchain-transcation-service-lab/

The backend itself is containerized and published through GitHub Actions/GHCR when the production CI gate succeeds. GitHub Pages is the public project showcase; it is not the API runtime.


## Public runtime deployment

The GitHub Pages dashboard is the public project showcase. For an actual internet-facing Node.js API and workers, the repository is prepared for Railway deployment using MySQL, MongoDB, private service networking, and separate API/outbox/confirmation services.

See [docs/RAILWAY-DEPLOYMENT.md](docs/RAILWAY-DEPLOYMENT.md).

OpenAPI specification: [docs/openapi.yaml](docs/openapi.yaml).


### Reorganization safety

Confirmed transactions now persist the canonical block number and block hash. The confirmation worker periodically revalidates that evidence against the canonical chain. If the stored block is replaced, the transaction enters `REORGED`, clears the old confirmation evidence, and is revalidated before returning to `CONFIRMED`. A transient receipt read does not by itself trigger a reorg state when the stored block remains canonical.
