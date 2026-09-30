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
Load transaction -> validate lifecycle -> lock -> blockchain adapter -> ethers.js/RPC -> receive transaction hash -> persist SUBMITTED -> publish event.

Production execution should obtain the hash from the service's blockchain broadcast operation rather than trusting an arbitrary caller-supplied hash. External hashes may only be accepted through an explicit verified reconciliation/demo path.

## Confirmation
SUBMITTED -> query blockchain receipt -> verify receipt -> persist block/receipt evidence -> CONFIRMED.

No receipt or temporary RPC failure does not by itself mean FAILED.

## Failure
Known and verified failure -> FAILED. Unknown blockchain outcome -> reconciliation workflow.

## Anchor
Confirmed transaction -> prepare receipt data -> TransactionReceiptAnchor contract -> persist separate anchor transaction hash and block data.

## Outbox
MySQL state/event/outbox commit -> worker claims event -> MongoDB write -> mark processed. Failed delivery is retried with bounded backoff.

## Audit
Transaction history is reconstructed from durable lifecycle/audit events and blockchain evidence. MongoDB is a derived read model and not the source of truth.

## Health
/health reports process health.
 /ready reports required dependencies for serving traffic. MongoDB worker health should be monitored separately because it is not authoritative for transaction state.

## End-to-end
Create -> Submit -> Confirm -> Anchor -> Audit.
