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
Transaction -> ethers.js -> Ethereum -> receipt anchor
```

## Security conclusion

Classic filesystem path traversal is not directly applicable to the transaction lookup because the service does not use user-controlled transaction IDs as filesystem paths.

The service still rejects traversal-style payloads because hostile path input should be rejected at the HTTP boundary.

## Remaining production risks

The project is a production-oriented engineering lab, not a live custody platform.

Remaining controls for real-money usage:

- durable execution queue
- RPC failover
- nonce management
- fee policy
- chain allowlist
- confirmation depth beyond the current receipt check
- reorg handling
- on-chain reconciliation
- distributed rate limiting
- managed secrets
- centralized observability
- backup/restore validation
- disaster recovery
- external security review


## Final CI review notes

Two CI regressions were found during the multi-database and Hardhat refactor:

1. The Node test command was changed to `node --test test`, which Node interpreted as a test target named `test`. It was corrected to `node --test test/*.test.js` so Hardhat Mocha tests remain isolated.
2. The MySQL integration fixture used a conflicting idempotency request with a mismatched amount. The fixture was corrected, and the persistence implementation was also hardened so idempotency behavior is determined from the locked database row rather than driver-specific affected-row semantics.

A container-publish workflow issue was also found: the original pinned build-push-action reference did not resolve. It is now updated to a valid published action release, and manual dispatch uses the main branch explicitly.

The latest successful Security Checks run verified application tests, Hardhat compilation/tests, dependency audit, and repository health. The Transaction Service CI is the final gate before container publication.
