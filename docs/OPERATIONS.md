# Production Hardening Checklist

This project is an engineering lab. The checklist below defines the next controls required for a production deployment.

## Application

- [x] Idempotency handling
- [x] Idempotency conflict detection
- [x] Explicit transaction state machine
- [x] Exact decimal-string amount handling
- [x] Request body size limit
- [x] Authentication boundary
- [x] Rate limiting
- [x] Security headers
- [x] Health and readiness endpoints
- [x] Graceful SIGTERM/SIGINT shutdown
- [ ] Durable PostgreSQL persistence
- [ ] Distributed idempotency constraint
- [ ] Durable queue
- [ ] Worker retry/backoff policy
- [ ] RPC failover
- [ ] Confirmation-depth policy
- [ ] Reconciliation scheduler
- [ ] Dead-letter queue
- [ ] Distributed rate limiting

## Infrastructure

- [x] Non-root container
- [x] Container healthcheck
- [x] Secret exclusion from Git
- [x] CI dependency audit
- [ ] TLS termination
- [ ] Network firewall/security-group rules
- [ ] Private database subnet
- [ ] Secret manager
- [ ] Centralized logs
- [ ] Metrics and alerting
- [ ] Backup and restore testing

## Blockchain safety

- [ ] Chain allowlist
- [ ] RPC endpoint health checks
- [ ] Nonce management
- [ ] Gas/fee policy
- [ ] Confirmation depth
- [ ] Reorg handling
- [ ] Receipt verification
- [ ] On-chain reconciliation

Do not connect this repository to real funds until the unchecked persistence, queue, blockchain, infrastructure, and security controls have been implemented and reviewed.
