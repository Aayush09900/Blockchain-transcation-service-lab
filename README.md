# Blockchain Transaction Service Lab

A small backend lab for designing **reliable blockchain transaction processing**.

The goal is to practice the engineering problems that appear between an API request and an on-chain confirmation:

`API request → idempotency → transaction state → broadcast → confirmation → reconciliation`

## What this repository demonstrates

- Idempotency keys for duplicate client requests
- Explicit transaction state transitions
- Separation of an internal request ID from the blockchain transaction hash
- Confirmation tracking
- Retry-safe state handling
- Small, testable service boundaries
- CI validation with Node.js

This is intentionally an educational core service, not a production custody system.

## State model

`CREATED → SUBMITTED → CONFIRMED`

A transaction may also move to `FAILED` from `CREATED` or `SUBMITTED`.

Terminal states are not silently overwritten. An already-confirmed transaction remains confirmed even when a duplicate request arrives.

## Example

```js
const service = new TransactionService();

const first = service.submit({
  idempotencyKey: "withdrawal-123",
  from: "0xsender",
  to: "0xreceiver",
  amount: "1000000000000000"
});

const duplicate = service.submit({
  idempotencyKey: "withdrawal-123",
  from: "0xsender",
  to: "0xreceiver",
  amount: "1000000000000000"
});

// Same internal transaction is returned.
console.log(first.id === duplicate.id);
```

## Run

```bash
npm install
npm test
```

## Engineering roadmap

Next increments are planned around:

1. Persistent storage
2. Retry/backoff policy
3. Chain confirmation depth
4. RPC failure handling
5. Reconciliation jobs
6. PostgreSQL persistence
7. Queue-based workers
8. Observability and audit logs
9. API authentication and authorization
10. Multi-chain transaction adapters

## Open-source learning

The repository is intentionally small so changes can be reviewed easily. Contributions should focus on reliability, testing, documentation, and blockchain integration patterns.

**Do not use this repository for real funds or production custody.**
