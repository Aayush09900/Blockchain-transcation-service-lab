# Operations Checklist

## Application

- [x] MySQL transactional persistence
- [x] MySQL idempotency constraint
- [x] MySQL transaction outbox
- [x] MongoDB audit/read model
- [x] ethers.js blockchain boundary
- [x] Hardhat contract test suite
- [x] Request validation
- [x] Path security tests
- [x] Rate-limit bounds
- [x] Security headers
- [x] Health/readiness
- [x] Graceful shutdown
- [x] Non-root container
- [x] CI security validation
- [x] Repository health check

## Infrastructure

- [x] Docker Compose development stack
- [x] MySQL healthcheck
- [x] MongoDB healthcheck
- [x] Secret exclusion from Git
- [x] Production configuration validation
- [ ] TLS termination
- [ ] Cloud firewall/security-group policy
- [ ] Private database networking
- [ ] Managed secret storage
- [ ] Centralized logs
- [ ] Metrics and alerting
- [ ] Backup and restore testing

## Blockchain

- [x] ethers.js adapter
- [x] chain ID validation
- [x] on-chain anchor contract
- [x] Hardhat integration tests
- [ ] RPC failover
- [ ] Nonce management
- [ ] Fee/gas policy
- [ ] Chain allowlist
- [ ] Confirmation-depth policy
- [ ] Reorg handling
- [ ] Receipt verification
- [ ] Reconciliation

## Data consistency

The system of record is MySQL.

MongoDB is an audit/read model and must never be treated as the authoritative transaction ledger.

The MySQL outbox provides the durable handoff between transactional state and MongoDB. MongoDB event records retain the source outbox occurrence time, and transaction snapshots only advance when the incoming MySQL `updated_at` is newer, preventing an out-of-order worker from regressing the read model.

## Deployment

For a real production deployment:

1. provision MySQL with backups and restricted network access;
2. provision MongoDB with authentication, TLS and appropriate replica configuration;
3. provision a managed secret store;
4. deploy the API and outbox worker separately;
5. place the API behind TLS and a network firewall;
6. configure blockchain RPC credentials and an allowlisted chain;
7. deploy the receipt-anchor contract only through an audited deployment process;
8. enable metrics, logs and alerts;
9. test restore and disaster recovery before handling real funds.

Do not run the production configuration without these infrastructure controls.


## Blockchain confirmation worker

When blockchain execution is enabled, start the confirmation worker with the `blockchain` Compose profile:

```bash
docker compose --profile blockchain up --build
```

The worker polls MySQL transactions in `SUBMITTED` state, queries the configured Ethereum RPC for receipts, and transitions successful receipts to `CONFIRMED` or reverted receipts to `FAILED`.

The API can still expose the manual `/confirm` endpoint for deterministic operational checks.


### Broadcast crash recovery

The confirmation worker also scans `BROADCASTING` transactions. When an API process loses the database write after an Ethereum anchor was broadcast, the worker searches recent `TransactionAnchored` events for the transaction ID, recovers the on-chain transaction hash, verifies the transaction payload, and resumes the MySQL lifecycle at `SUBMITTED`.

Configure the recovery window with:

```text
CHAIN_RECOVERY_LOOKBACK_BLOCKS=20000
```

The lookback must cover the block range in which a crashed broadcast could have been mined. For long-running production systems, set this based on expected outage duration and chain block time, or replace the bounded scan with an indexed event/reconciliation service.


### Outbox worker concurrency

The MySQL outbox uses a lease (`claimed_by` / `claimed_until`) with `FOR UPDATE SKIP LOCKED`. This prevents multiple worker instances from actively claiming the same pending row while allowing another worker to recover an abandoned claim after the lease expires.

The worker defaults to a 50-event batch and a 60-second lease. Configure `OUTBOX_BATCH_SIZE` and `OUTBOX_LEASE_MS` for the expected event-processing latency; the application enforces a 10-second minimum and 15-minute maximum lease.

For databases created before the lease columns existed, apply `db/mysql/002_outbox_leases.sql` during the deployment migration step before starting multiple outbox workers.
