# Security Architecture

## Layered protection model

### 1. Network edge

- Put the service behind HTTPS/TLS.
- Allow only required inbound ports.
- Keep databases and internal queues on private networks.
- Use cloud firewall or security-group rules to restrict traffic.

### 2. Application edge

- Authenticate protected requests.
- Authorize actions by role or scope.
- Enforce payload size and schema limits.
- Apply per-client and per-IP rate limits.
- Use request IDs for tracing.

### 3. Transaction safety

- Require an idempotency key for mutating requests.
- Reject invalid state transitions.
- Separate internal IDs from blockchain transaction hashes.
- Never treat a submitted transaction as confirmed without chain evidence.

### 4. Secret protection

- Never store private keys, seed phrases, RPC credentials, or API secrets in Git.
- Use a secret manager or environment-level configuration.
- Rotate credentials after suspected exposure.

### 5. Observability

- Record structured audit events.
- Monitor repeated failures and retry storms.
- Alert on authentication anomalies and unexpected transaction-state changes.
- Never log secrets.

## Important limitation

This repository is a learning lab. These controls describe the hardening architecture required for a production deployment; they are not a claim that the current code is production-ready or a substitute for infrastructure-level firewall configuration and security review.
