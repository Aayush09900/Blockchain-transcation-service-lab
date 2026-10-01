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
- [x] Authenticated metrics endpoint
- [x] Structured application and worker telemetry

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
- [ ] Centralized metrics scraping and alerting
- [ ] Backup and restore testing

## Blockchain

- [x] ethers.js adapter
- [x] chain ID validation
- [x] on-chain anchor contract
- [x] Hardhat integration tests
- [x] RPC failover across configured endpoints
- [x] Process-local nonce management
- [x] Bounded fee/gas policy
- [x] Chain allowlist via exact configured chain ID
- [x] Confirmation-depth policy
- [x] Canonical block-hash revalidation and reorg recovery
- [x] Receipt verification
- [x] Broadcast reconciliation from indexed anchor events

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

The `/submit` and `/anchor` endpoints persist `BROADCASTING` before broadcasting. When the API loses the post-broadcast database write or the RPC response is ambiguous, the worker searches recent `TransactionAnchored` events for the transaction ID, recovers the on-chain transaction hash, verifies the transaction payload, and resumes the MySQL lifecycle at `SUBMITTED`. The API never marks this ambiguous case as `FAILED`.

Configure the recovery window with:

```text
CHAIN_RECOVERY_LOOKBACK_BLOCKS=20000
```

The lookback must cover the block range in which a crashed broadcast could have been mined. For long-running production systems, set this based on expected outage duration and chain block time, or replace the bounded scan with an indexed event/reconciliation service.


### Outbox worker concurrency

The MySQL outbox uses a lease (`claimed_by` / `claimed_until`) with `FOR UPDATE SKIP LOCKED`. This prevents multiple worker instances from actively claiming the same pending row while allowing another worker to recover an abandoned claim after the lease expires.

The worker defaults to a 50-event batch and a 60-second lease. Configure `OUTBOX_BATCH_SIZE` and `OUTBOX_LEASE_MS` for the expected event-processing latency; the application enforces a 10-second minimum and 15-minute maximum lease.

For databases created before the lease columns existed, apply `db/mysql/002_outbox_leases.sql` during the deployment migration step before starting multiple outbox workers.

For databases created before canonical confirmation evidence existed, apply `db/mysql/003_confirmation_evidence.sql` before enabling reorg recovery.


### Blockchain confirmation depth

When blockchain confirmation is enabled, `CHAIN_CONFIRMATIONS` controls how many blocks must include the mined transaction before the service can move it to `CONFIRMED`.

The default is 1. Production deployments should select a confirmation depth appropriate for the target chain and risk model. This setting reduces the chance of treating a transaction as final immediately after its first block, but it does not by itself implement reorg handling.


### RPC failover and signer nonce management

The blockchain adapter accepts the legacy single `CHAIN_RPC_URL` setting and an optional comma-separated `CHAIN_RPC_URLS` set. With multiple endpoints, ethers.js `FallbackProvider` is used so a slow or unavailable endpoint does not become a single point of failure. The provider uses quorum 1 for availability; production operators should use independently managed endpoints and monitor provider health.

The signer is wrapped with ethers.js `NonceManager` so concurrent submissions within one API process are serialized with sequential nonces. This does not provide a distributed nonce lease across multiple API replicas. A real multi-replica deployment still requires one signer worker or a durable database/coordination mechanism for cross-instance nonce ownership.

Example:

```text
CHAIN_RPC_URL=https://rpc-a.example
CHAIN_RPC_URLS=https://rpc-a.example,https://rpc-b.example
CHAIN_ID=11155111
```


### Blockchain reorganization handling

Every blockchain confirmation stores the mined block number and block hash in MySQL. The confirmation worker rechecks the canonical block hash for recent `CONFIRMED` transactions. A replaced block moves the transaction to `REORGED`, clears the stale confirmation evidence, and causes the worker to re-verify the stored transaction intent before reconfirming it. The reorg check treats a temporary receipt read failure as indeterminate while the stored block remains canonical, preventing a single unhealthy RPC response from creating a false reorg.


### Fee and gas policy

When blockchain execution is enabled, production configuration requires `CHAIN_MAX_FEE_PER_GAS_WEI` and `CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI`. The adapter checks current provider fee data before broadcasting and refuses a submission when the network fee exceeds the configured ceiling. Optional `CHAIN_GAS_LIMIT` applies an explicit transaction gas limit. The priority-fee ceiling must not exceed the max-fee ceiling.

Example:

```text
CHAIN_MAX_FEE_PER_GAS_WEI=50000000000
CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI=2000000000
CHAIN_GAS_LIMIT=100000
```

These are ceilings, not chain-specific recommendations. Operators must choose values appropriate for the target chain and transaction contract.
