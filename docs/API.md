# HTTP API

All protected endpoints require:

`Authorization: Bearer <API_TOKEN>`

## GET /health

Returns basic liveness information without exposing database details.

## GET /ready

Checks:

- MySQL
- ethers.js chain connectivity when blockchain is enabled

MongoDB is owned by the outbox worker. MongoDB availability does not make the transaction API accept or reject authoritative transaction writes because MySQL is the source of truth.

## POST /v1/transactions

Creates a transaction.

Headers:

`Idempotency-Key: <unique-key>`

Body:

```json
{
  "from": "0xsender",
  "to": "0xreceiver",
  "amount": "0.001"
}
```

Amounts are accepted as decimal strings and are never processed through JavaScript Number conversion.

## GET /v1/transactions/:id

Returns the authoritative MySQL transaction record.

Transaction IDs are restricted to UUID format.

A confirmed blockchain transaction also exposes its canonical `confirmedBlockNumber` and `confirmedBlockHash` when blockchain verification is enabled.

## POST /v1/transactions/:id/submit

The request body is empty:

```json
{}
```

The service controls blockchain submission. It never trusts a caller-supplied transaction hash. The lifecycle is:

`CREATED -> BROADCASTING -> SUBMITTED`

The configured blockchain signer broadcasts the anchor transaction and the service persists the returned transaction hash. Repeated calls after execution starts return the existing authoritative state without rebroadcasting.

If the broadcast result is ambiguous, the transaction remains `BROADCASTING`. The confirmation worker searches recent `TransactionAnchored` events, verifies the recovered transaction against the stored intent, and resumes the lifecycle.

## POST /v1/transactions/:id/confirm

When blockchain mode is enabled, the service verifies the stored transaction hash against the configured RPC before confirming.

Moves:

`SUBMITTED -> CONFIRMED`

If a previously confirmed block is reorganized, the confirmation worker moves the record to `REORGED` while it revalidates the transaction against the canonical chain.

If no receipt is available yet, the endpoint returns `409`. If the receipt status is reverted, the transaction is marked `FAILED`.

## POST /v1/transactions/:id/fail

Body:

```json
{
  "reason": "RPC timeout"
}
```

Moves:

`CREATED|SUBMITTED -> FAILED`

## POST /v1/transactions/:id/anchor

This endpoint is retained as a compatibility alias for the same service-controlled broadcast operation used by `/submit`.

It uses the configured signer, returns HTTP `202` for a new broadcast, and leaves the record in `SUBMITTED` until receipt verification completes.

This is a blockchain audit anchor, not a user-fund transfer endpoint.

## GET /v1/transactions/:id/events

Returns the MongoDB audit/read-model events associated with a transaction.

## Idempotency behavior

The same idempotency key and same request returns the original transaction.

The same idempotency key with different sender, receiver or amount returns a conflict.

The uniqueness guarantee is enforced in MySQL.
