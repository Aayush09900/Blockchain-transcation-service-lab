# Security Test Report

## Scope

Security-focused regression testing for:

- Transaction ID path handling
- Path traversal probes
- Malformed URL encoding
- Authentication boundaries
- Rate-limit exhaustion
- Security headers
- Internal error disclosure

## Findings and remediation

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| SEC-01 | Transaction routes accepted arbitrary identifier strings before the data layer | Medium | Fixed |
| SEC-02 | Encoded path separators and malformed path payloads reached transaction lookup before strict validation | Medium | Fixed |
| SEC-03 | The in-memory rate limiter could grow without a hard client-entry bound | Medium | Fixed |
| SEC-04 | Unexpected internal errors could expose raw error messages to API clients | High | Fixed |
| SEC-05 | Bearer token comparison used ordinary string equality | Low | Fixed |
| SEC-06 | Health/readiness responses exposed the persistence implementation | Low | Fixed |
| SEC-07 | Local Docker Compose file contained hardcoded database/API credentials | High | Fixed |
| SEC-08 | PostgreSQL path bypassed core input validation in the API layer | High | Fixed |
| SEC-09 | Concurrent idempotency requests could race before insert | High | Fixed |
| SEC-10 | PostgreSQL submission attempts were not incremented | Medium | Fixed |
| SEC-11 | CORS preflight could echo an origin when no allowlist was configured | Medium | Fixed |
| SEC-12 | Production startup allowed missing API/database configuration | High | Fixed |
| SEC-13 | CI security workflow failed because npm cache required a lockfile that was not present | Medium | Fixed |

## Configuration secret investigation

The Docker Compose configuration originally contained literal database and API credentials. Those values are now required through environment variables, and the example configuration documents the expected variables without embedding real credentials.

## Production configuration and consistency review

The PostgreSQL-backed API previously validated transaction input differently from the in-memory path. The database path now reuses the same canonical input validator.

Idempotency creation now uses a database uniqueness constraint with INSERT ... ON CONFLICT DO NOTHING followed by a locked read, closing a concurrent-request race.

Submission attempts are incremented inside the PostgreSQL state transition transaction, and transaction-hash mismatches are rejected.

Production configuration now requires API_TOKEN and DATABASE_URL. Production database TLS defaults on unless explicitly disabled.

CORS preflight responses are now disabled unless an explicit CORS allowlist is configured.

## Path traversal investigation

A classic filesystem path traversal attack such as ../etc/passwd was not directly exploitable in the original transaction lookup path because the transaction ID was used for a map/database lookup rather than a filesystem operation, and database queries are parameterized.

The input was still unnecessarily permissive. The service now:

1. Decodes the URL segment.
2. Rejects malformed percent-encoding.
3. Rejects dot-segments and encoded separators indirectly through strict validation.
4. Requires the UUID format used by generated transaction IDs.
5. Rejects unexpected control characters and arbitrary identifiers before reaching the data layer.

## High-priority issue: internal error disclosure

Unexpected exceptions previously fell through to the HTTP handler and their raw message could be returned to the client.

This is dangerous because database, infrastructure, or library failures can contain implementation details or sensitive operational information.

The handler now:

- maps known client errors to safe messages;
- returns a generic internal server error for unexpected exceptions;
- logs only non-secret error metadata server-side.

## Rate-limit memory exhaustion

The original in-memory limiter stored a map entry for every unique client key without a hard upper bound.

A high volume of rotating client addresses could increase memory usage.

The limiter now:

- expires old entries;
- enforces a maximum client count;
- evicts the oldest entry when the bound is reached.

For horizontally scaled production deployments, the application should use a distributed rate limiter backed by shared infrastructure.

## Authentication hardening

Bearer-token validation now:

- fails closed when authentication is not configured;
- rejects malformed multi-token Authorization headers;
- compares equal-length secrets with a timing-safe primitive.

This is still a single static service token, so production multi-user authorization should use an established identity and authorization model.

## Test file

Security regression tests are located at:

test/security-vulnerabilities.test.js

Run locally with:

npm test

## Current architecture

Client/API
-> Security Edge
-> Authentication
-> Rate Limiting
-> Input Validation
-> Transaction Service
-> PostgreSQL
-> Queue/Worker (planned)
-> Blockchain RPC
-> Confirmation/Event Listener
-> Reconciliation/Audit

## Remaining production security work

The project is still a learning lab, not a production custody platform.

Remaining work includes:

- durable queue and worker processing
- retry/backoff and dead-letter handling
- RPC failover
- nonce management
- chain allowlisting
- confirmation depth and reorg handling
- distributed rate limiting
- secret manager integration
- infrastructure firewall/security-group policy
- TLS termination
- centralized metrics and logs
- backup and restore testing
- independent security review
