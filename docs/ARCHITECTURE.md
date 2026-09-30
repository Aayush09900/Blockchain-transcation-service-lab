# System Architecture

## Architecture decision

Use MySQL as the transactional system of record, MongoDB as an audit/read model, ethers.js as the blockchain boundary, and Hardhat as the local Ethereum test environment.

This avoids using MongoDB as the primary financial ledger while still gaining a document-oriented event/history model.

## 1. Request plane

```
Client
  |
  v
HTTP API
  |
  +--> Authentication
  +--> Rate Limiting
  +--> CORS
  +--> Content-Type Validation
  +--> JSON Validation
  +--> UUID Path Validation
  |
  v
Transaction Service
```

## 2. Transaction state plane

MySQL owns:

- transaction identity
- idempotency key
- sender/receiver
- exact decimal amount
- transaction status
- transaction hash
- attempt count
- failure reason
- timestamps
- outbox events

The transaction and its outbox entry are written in the same MySQL transaction.

## 3. Outbox pattern

```
MySQL transaction
      |
      +--> transactions
      |
      +--> transaction_outbox
                    |
                    v
              outbox-worker
                    |
                    v
                 MongoDB
```

The worker is intentionally separate from the HTTP server.

If publishing fails, the outbox row remains unpublished and its attempt count/error are updated.

MongoDB uses a unique event ID, making repeated delivery idempotent.

## 4. Blockchain plane

```
Transaction
    |
    v
ethers.js adapter
    |
    +--> JsonRpcProvider
    +--> Wallet signer
    +--> Contract
    |
    v
Ethereum network
    |
    v
Receipt monitor worker
    |
    v
MySQL SUBMITTED -> CONFIRMED/FAILED
```

The adapter is isolated in `src/blockchain-adapter.js`.

The included Solidity contract is an educational receipt anchor. It stores the transaction identity, sender, receiver and amount and emits an indexed event.

It does not custody user funds.

## 5. Testing plane

```
Hardhat 3
  |
  +--> Solidity compiler
  +--> local EVM
  +--> hardhat-ethers
  +--> ethers.js
  |
  v
TransactionReceiptAnchor tests
```

Hardhat 3 supports both Solidity and TypeScript/JavaScript testing strategies and provides test profiles that can increase fuzzing intensity in CI. citeturn590372search1turn590372search0

## 6. Database responsibilities

### MySQL

Use for:

- source-of-truth transaction state
- idempotency
- state transitions
- transactional outbox

MySQL2 provides connection pooling, prepared statements and Promise APIs. citeturn933955search0turn933955search2

### MongoDB

Use for:

- immutable audit events
- transaction snapshots
- read-heavy history queries

The official Node driver supports majority write concerns and ACID multi-document transactions when a future use case needs them. citeturn849922search0turn849922search4

## 7. Failure model

### MySQL unavailable

API is not ready and the service should not accept new transactions.

### MongoDB unavailable

The source-of-truth transaction remains in MySQL. The outbox remains pending and can be retried.

### RPC unavailable

Blockchain operations fail without changing the authoritative transaction state to confirmed.

### Worker crash

Unpublished outbox records remain in MySQL.

### Duplicate API request

MySQL idempotency constraint returns the existing transaction.

### Duplicate Mongo delivery

MongoDB unique event ID makes the second delivery a no-op.

### Blockchain receipt delayed

The API stores the broadcast transaction hash as `SUBMITTED` without waiting for mining. The confirmation worker polls receipts and moves the transaction to `CONFIRMED` only after a successful receipt.

## 8. Production next steps

- Dedicated durable queue for blockchain execution
- RPC failover and health scoring
- Nonce manager
- Gas/fee policy
- Confirmation depth
- Reorg detection
- On-chain receipt verification
- Confirmation depth beyond a single mined receipt
- Reorg detection
- Durable execution/reconciliation queue
- Distributed rate limiting
- OpenTelemetry metrics/tracing
- Managed secrets
- Production TLS and network policy
- Backup/restore automation
- Disaster recovery
- External security review
