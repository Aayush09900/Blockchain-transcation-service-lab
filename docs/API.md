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

## POST /v1/transactions/:id/submit

The service controls blockchain submission. The caller does not supply a transaction hash.

Moves:

`CREATED -> BROADCASTING -> SUBMITTED`

The endpoint is idempotent: `BROADCASTING` returns 202, `SUBMITTED`/`CONFIRMED` returns the existing state, deterministic blockchain rejection becomes `FAILED`, and ambiguous RPC errors remain `BROADCASTING` for reconciliation.

## POST /v1/transactions/:id/reconcile

Operational recovery endpoint for an externally discovered transaction hash.

Body:

```json
{
  "txHash": "0x..."
}
```

The hash is verified against the intended transaction before it can be accepted.

## POST /v1/transactions/:id/confirm

When blockchain mode is enabled, the service verifies the stored transaction hash against the configured RPC before confirming.

Moves:

`SUBMITTED -> CONFIRMED`

If no receipt is available yet, the endpoint returns `409`. If the receipt status is reverted, the transaction is marked `FAILED`.

## POST /v1/transactions/:id/fail

Body:

```json
{
  "reason": "RPC timeout"
}
```

Moves:

`CREATED|BROADCASTING|SUBMITTED -> FAILED`

## POST /v1/transactions/:id/anchor

Backward-compatible alias for service-controlled submission. The configured signer calls the on-chain receipt anchor contract, and the caller cannot supply the transaction hash.

This is a blockchain audit anchor, not a user-fund transfer endpoint.

## GET /v1/transactions/:id/events

Returns the MongoDB audit/read-model events associated with a transaction.

## Idempotency behavior

The same idempotency key and same request returns the original transaction.

The same idempotency key with different sender, receiver or amount returns a conflict.

The uniqueness guarantee is enforced in MySQL.
