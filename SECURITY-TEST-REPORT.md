# Security Test Report

## Scope

The repository was re-checked across:

- API boundary
- transaction state machine
- MySQL persistence
- MySQL idempotency
- MySQL outbox
- MongoDB audit layer
- path validation
- authentication
- rate limiting
- configuration
- ethers.js blockchain boundary
- Solidity contract behavior
- Hardhat tests
- Docker and CI structure

## Findings fixed in this architecture pass

| ID | Finding | Severity | Resolution |
| --- | --- | ---: | --- |
| SEC-01 | Transaction path accepted arbitrary identifiers | Medium | Strict UUID validation |
| SEC-02 | Encoded traversal-style paths were not rejected early | Medium | URL decoding plus UUID validation |
| SEC-03 | In-memory rate limiter could grow without a hard bound | Medium | Expiration and maximum entry cap |
| SEC-04 | Internal error messages could leak to clients | High | Safe public error mapping |
| SEC-05 | Bearer-token comparison used normal equality | Low | Timing-safe comparison |
| SEC-06 | Unconfigured CORS could echo arbitrary origins | Medium | CORS disabled unless explicitly allowlisted |
| SEC-07 | Production could start without required persistence/security settings | High | Production config validation |
| SEC-08 | PostgreSQL architecture did not match the requested multi-database design | Medium | Replaced with MySQL + MongoDB |
| SEC-09 | Database transaction and audit handoff had no durable outbox | High | Added MySQL transactional outbox |
| SEC-10 | Blockchain code was not isolated from the HTTP layer | Medium | Added ethers.js adapter boundary |
| SEC-11 | Smart-contract behavior lacked a dedicated Hardhat test suite | High | Added Hardhat 3 + ethers integration tests |
| SEC-12 | Repository validation did not check the full technology stack | Medium | Expanded repository health check |
| SEC-13 | Blockchain submission waited for receipt inside the broadcast request | Medium | Split broadcast from confirmation and verify receipts before CONFIRMED |
| SEC-14 | Submitted blockchain transactions depended on a caller to trigger confirmation | Medium | Added a dedicated receipt-monitor worker that reconciles SUBMITTED transactions |
| SEC-15 | Confirmation checked receipt status without proving the mined transaction matched the stored intent | High | Added on-chain transaction/payload verification before CONFIRMED |
| SEC-16 | Runtime/worker errors could expose credential-bearing connection strings in logs | High | Added centralized log redaction and control-character sanitization |
| SEC-17 | Production blockchain configuration accepted weak transport/key/address settings | High | Enforced HTTPS RPC, chain ID, contract address and private-key format validation |
| SEC-18 | CI action references were mutable tags | Medium | Pinned security-sensitive GitHub Actions to immutable commit SHAs |
| SEC-19 | Runtime image included npm CLI dependency tree with high/critical findings | High | Updated Node LTS base and removed npm/npx from runtime image after dependency installation |
| SEC-20 | Container services retained unnecessary Linux privileges | Medium | Added no-new-privileges, dropped capabilities, read-only root filesystem and hardened /tmp |
| SEC-21 | Numeric JSON amounts could be coerced before validation | High | Amount validation now requires decimal strings to prevent floating-point precision loss |
| SEC-22 | Lockfile bootstrap relied on setup-node automatic npm cache detection while no lockfile was committed | Medium | Replaced it with a committed lockfile and switched CI/security/runtime installs to `npm ci` |
| SEC-23 | Concurrent outbox workers could claim the same event simultaneously | High | Added MySQL leases with `FOR UPDATE SKIP LOCKED`, worker ownership, and lease expiry recovery |
| SEC-24 | Supply-chain scanning was limited to npm audit and container scanning | Medium | Added CodeQL for JavaScript/TypeScript while retaining npm audit and container scanning; dependency-review is not enabled |
| SEC-25 | Repository health check did not enforce immutable GitHub Action references or lockfile presence | Medium | Health check now requires package-lock.json, security workflows, and full 40-character action commit SHAs |
| SEC-26 | Submission endpoint trusted a caller-supplied transaction hash | High | Submission now uses the service-controlled blockchain adapter/signer; arbitrary txHash input is rejected |
| SEC-27 | Broadcast/RPC or post-broadcast persistence ambiguity could be converted into FAILED | High | Transaction remains BROADCASTING until reconciliation recovers and verifies the on-chain anchor |
| SEC-28 | Concurrent submit/claim errors could be reported as blockchain broadcast ambiguity | Medium | Broadcast-ambiguity wrapping is now limited to actual broadcast and post-broadcast persistence failures; initial BROADCASTING claim errors propagate unchanged |
| SEC-29 | Single-RPC dependency and concurrent signer calls could create availability or nonce-collision risk | High | Added multi-RPC FallbackProvider support and process-local NonceManager serialization; distributed nonce coordination remains a deployment requirement |
| SEC-30 | Confirmed transactions lacked durable canonical block evidence for post-confirmation reorg detection | High | Persist confirmed block number/hash, revalidate canonical block evidence, and recover transactions through the REORGED state |
| SEC-31 | Confirmation could be attempted without durable blockchain evidence | Medium | Require a stored tx hash before blockchain confirmation and return a safe 409 response |
| SEC-32 | Blockchain broadcasts lacked a production fee ceiling and multi-replica signer coordination | High | Added max fee/priority fee/gas-limit policy and a MySQL-backed advisory lock around service-controlled broadcasts; cross-database signer coordination remains out of scope |
| SEC-33 | Signer-lock contention could move a transaction to `BROADCASTING` before the lock was acquired, leaving a safe retry path unavailable | Medium | Acquire the advisory lock before the `BROADCASTING` transition and re-read authoritative state inside the lock; added regression coverage for lock failure and stale concurrent callers |

## Current observability controls

- Authenticated `/metrics` endpoint.
- Low-cardinality HTTP counters and latency histogram.
- Broadcast and verification outcome telemetry.
- Outbox event-lag and publish/failure telemetry.
- Confirmation and reorg recovery telemetry.
- Throttled worker heartbeats.

## Current architecture

```
Client
  |
Security Edge
  |
Transaction API
  |
MySQL source of truth
  |
MySQL transactional outbox
  |
Outbox worker
  |
MongoDB audit/read model

Optional blockchain path:
Transaction -> ethers.js -> Ethereum -> receipt anchor -> verified receipt -> MySQL
```

## Security conclusion

Classic filesystem path traversal is not directly applicable to the transaction lookup because the service does not use user-controlled transaction IDs as filesystem paths.

The service still rejects traversal-style payloads because hostile path input should be rejected at the HTTP boundary.

## Remaining production risks

The project is a production-oriented engineering lab, not a live custody platform.

Remaining controls for real-money usage:

- durable execution queue
- cross-instance nonce coordination
- cross-database signer coordination
- chain allowlist
- cross-provider finality monitoring for deep-chain reorgs
- on-chain reconciliation for unresolved broadcasts; ongoing reorg reconciliation remains required
- distributed rate limiting
- managed secrets
- centralized observability
- backup/restore validation
- disaster recovery
- external security review
- durable broadcast/reconciliation for transactions that remain unresolved beyond the configured event lookback window
- cross-instance nonce coordination for multiple signer processes


## Final CI review notes

Two CI regressions were found during the multi-database and Hardhat refactor:

1. The Node test command was changed to `node --test test`, which Node interpreted as a test target named `test`. It was corrected to `node --test test/*.test.js` so Hardhat Mocha tests remain isolated.
2. The MySQL integration fixture used a conflicting idempotency request with a mismatched amount. The fixture was corrected, and the persistence implementation was also hardened so idempotency behavior is determined from the locked database row rather than driver-specific affected-row semantics.

A container-publish workflow issue was also found: the original pinned build-push-action reference did not resolve. It is now updated to a valid published action release, and manual dispatch uses the main branch explicitly.

Historical CI review notes are retained here for auditability. Before the current head is treated as validated, both Transaction Service CI and Security Checks must complete successfully, including the syntax, application, Hardhat, repository-health, dependency-audit, and container-scan gates where applicable.
