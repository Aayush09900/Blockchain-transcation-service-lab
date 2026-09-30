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
- confirmation depth
- reorg handling
- on-chain reconciliation
- distributed rate limiting
- managed secrets
- centralized observability
- backup/restore validation
- disaster recovery
- external security review
