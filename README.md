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
├── test/
│   ├── hardhat/
│   │   └── TransactionReceiptAnchor.test.js
│   ├── config.test.js
│   ├── mongo-audit-store.integration.test.js
│   ├── mysql-store.integration.test.js
│   ├── security-vulnerabilities.test.js
│   └── transaction-service.test.js
├── Dockerfile
├── docker-compose.yml
├── hardhat.config.js
├── package.json
├── README.md
├── SECURITY.md
└── SECURITY-TEST-REPORT.md
```

## Transaction lifecycle

`CREATED -> BROADCASTING -> SUBMITTED -> CONFIRMED`

A transaction may move to `FAILED` from `CREATED` or `SUBMITTED`.

Terminal states are protected from invalid rewrites.

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

{
  "txHash": "0x..."
}
```

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

This writes an on-chain receipt anchor for the transaction record. It is not a custody or user-fund transfer function.

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
- Production secret validation
- Security headers and CORS allowlisting
- CI dependency audit
- Hardhat contract tests
- Repository secret scanning

Infrastructure firewall rules, TLS certificates, private subnets, managed secrets, backups and alerting must be configured at the deployment platform.

## Production boundary

The repository is now structured as a production-oriented transaction service, but production custody requires additional operational controls:

- durable job queue and workers
- RPC failover
- nonce management
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
