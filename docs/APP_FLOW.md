# Application Flow

## Startup
Validate environment -> connect MySQL -> initialize MongoDB/audit worker -> initialize blockchain provider when enabled -> start HTTP API.

## Authentication
Client credentials/token -> authentication middleware -> authorized API request.

## Create transaction
Request -> authentication -> validation -> idempotency check -> MySQL transaction -> persist transaction + outbox -> commit -> return transaction ID/status.

## Idempotent retry
Same key + same request -> return original result.
Same key + different request -> reject with idempotency conflict.

## Submit
Load transaction -> atomically claim `BROADCASTING` -> blockchain adapter -> ethers.js/RPC -> receive service-generated transaction hash -> persist `SUBMITTED` -> publish event.

Repeated submit requests do not rebroadcast a `BROADCASTING` transaction. Ambiguous RPC results remain `BROADCASTING` until reconciliation.

## Reconciliation
`BROADCASTING` -> discover or receive transaction hash -> verify sender/receiver/amount/anchor payload -> `SUBMITTED` or `CONFIRMED`.

External hashes are accepted only through this verified reconciliation path.

## Failure
Known and verified failure -> FAILED. Unknown blockchain outcome -> reconciliation workflow.

## Anchor
Created transaction -> service-controlled blockchain adapter -> TransactionReceiptAnchor contract -> `BROADCASTING` -> `SUBMITTED` -> asynchronous receipt verification.

## Outbox
MySQL state/event/outbox commit -> worker claims event -> MongoDB write -> mark processed. Failed delivery is retried with bounded backoff.

## Audit
Transaction history is reconstructed from durable lifecycle/audit events and blockchain evidence. MongoDB is a derived read model and not the source of truth.

## Health
/health reports process health.
 /ready reports required dependencies for serving traffic. MongoDB worker health should be monitored separately because it is not authoritative for transaction state.

## End-to-end
Create -> Submit -> Confirm -> Anchor -> Audit.
