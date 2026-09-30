# HTTP API

## Health

GET /health

No authentication required.

Response:

{"status":"ok"}

## Readiness

GET /ready

No authentication required.

Response:

{"status":"ready"}

## Create transaction

POST /v1/transactions

Requires:

Authorization: Bearer <API_TOKEN>

Content-Type: application/json

Idempotency can be supplied using the Idempotency-Key header. The JSON body also accepts idempotencyKey.

Example:

{
  "from": "0xsender",
  "to": "0xreceiver",
  "amount": "1000000000000000"
}

The service preserves amounts as strings and rejects scientific notation or zero values.

Reusing an idempotency key with the same request returns the existing transaction. Reusing it with different transaction data is rejected.

## Get transaction

GET /v1/transactions/:id

Requires the same bearer token.

## Operational notes

The current implementation uses in-memory state. Restarting the process loses transaction state. Durable storage and a queue/worker boundary are required before production custody or real funds are introduced.
