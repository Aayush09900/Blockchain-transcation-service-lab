# Backend Schema

## Storage responsibilities

MySQL = authoritative application transaction state.
MongoDB = derived audit/read model.
Ethereum = external settlement/evidence source.

## Current MySQL model
The repository currently contains:
- transactions
- transaction_outbox

Idempotency information is stored on transactions in the current implementation.

## Transaction fields
Core data includes transaction UUID, status, amount, asset, sender/recipient, chain ID, tx hash, block information, contract/anchor information, error fields, request correlation, and timestamps.

Amounts are represented as decimal strings/integer-compatible database values rather than JavaScript floating-point values.

## Lifecycle events

The current implementation includes a BROADCASTING state between creation and blockchain submission.
Durable events should describe status changes and blockchain evidence. The current outbox is the durable event delivery mechanism. A separate transaction_events table is optional and should only be introduced if query/audit requirements justify it.

## Idempotency
The idempotency key is constrained at database level. Reusing a key with a different normalized request must be rejected.

## Outbox
Current outbox records carry event type, transaction/aggregate identity, payload, attempts, scheduling/processing information, and error information. Event claiming must be atomic or lease-based before multi-worker production deployment.

## MongoDB
Audit documents contain transaction identity, current read-model status, blockchain evidence, and ordered lifecycle events. MongoDB writes should be idempotent using stable event identifiers.

## Blockchain evidence
Keep original transaction fields separate from receipt-anchor transaction fields:
- txHash
- blockNumber
- blockHash
- receiptStatus
- gas information
- anchorTxHash
- anchorBlockNumber
- anchorContractAddress

## Integrity
State transition + durable event/outbox creation should commit atomically in MySQL. MongoDB failure must not invalidate an already committed authoritative transaction.

## Security
Do not persist private keys, seed phrases, JWT secrets, DB passwords, RPC credentials, or API secrets.
