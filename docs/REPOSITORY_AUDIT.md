# Repository Audit

## Baseline
Main branch audit baseline: `9c2a83029ab7fbd896e8f3aa23897db8ddfa827a`.

## Existing strengths
- Node.js HTTP API
- MySQL authoritative state and idempotency
- MongoDB audit/read model
- MySQL outbox
- ethers.js blockchain adapter
- dedicated blockchain confirmation worker
- Hardhat contract tests
- Docker and GitHub Actions
- validation, authentication, CORS, security headers, rate limiting
- chain ID validation and repository security checks

## Findings

### High — caller-supplied transaction hash
The submit endpoint currently accepts a txHash from the caller and can mark the transaction SUBMITTED after format validation. A production execution path should broadcast through the blockchain adapter and persist the returned hash, or explicitly verify externally supplied hashes against the intended transaction.

### High — manual confirmation mode
Confirmation can be asserted without receipt verification when blockchain mode is disabled. This must remain explicitly a lab/mock capability; production confirmation must be receipt-based.

### High — uncertain blockchain outcome
Broadcast errors can currently lead to FAILED. A timeout can occur after a transaction was accepted by the network, so ambiguous results require reconciliation rather than immediate terminal failure.

### Medium — outbox claiming
The outbox worker selects pending rows without an atomic multi-worker claim/lease. MongoDB event IDs provide idempotent insertion, but duplicate processing remains possible.

### Medium — confirmation worker tests
The confirmation worker needs dedicated integration coverage for pending receipts, successful receipts, reverted receipts, RPC failures, repeated polling, and terminal-state protection.

### Medium — reproducible dependencies
The repository does not currently include package-lock.json and uses npm install in CI/container workflows. A committed lockfile and npm ci should be introduced where appropriate.

### Low — stale documentation
README previously referenced test/hardhat while the repository uses hardhat-tests. The documentation has now been synchronized on this branch.

### Informational — MongoDB readiness
MongoDB is intentionally outside API readiness because MySQL is authoritative and MongoDB is maintained by the outbox worker. Worker/MongoDB health should be monitored separately.

### Medium for horizontal scaling — process-local rate limiting
The current limiter is in-memory. It is suitable for a single-instance lab; production multi-instance deployment needs a distributed limiter or gateway.

## Reconciliation decision
The current schema is intentionally simpler than the initial planned abstract schema. It uses `transactions` and `transaction_outbox`, with idempotency stored on transactions. The documentation now describes the actual model instead of requiring unnecessary table proliferation.

## Priority
1. Verified blockchain submission semantics.
2. Unknown-result reconciliation.
3. Atomic/leased outbox processing.
4. Confirmation-worker integration tests.
5. Reproducible dependency installation.
6. Observability and distributed deployment hardening.

## Production boundary
The repository is production-oriented but is not certified for real-money custody or financial settlement. Production requires additional controls including RPC redundancy, nonce/fee management, reorg handling, reconciliation, managed secrets, distributed rate limiting, backups, disaster recovery, monitoring, and independent security review.
