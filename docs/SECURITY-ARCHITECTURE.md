# Security Architecture

## Trust boundaries

### Internet -> API

Controls:

- TLS at deployment edge
- authentication
- minimum 32-character production bearer token
- request-ID control-character rejection
- rate limiting
- request size limits
- JSON/content-type validation
- CORS allowlist
- security headers

### API -> MySQL

Controls:

- pooled connections
- parameterized/prepared queries
- MySQL unique constraints
- row locking
- ACID transaction boundaries
- exact decimal storage

### API/Worker -> MongoDB

Controls:

- authenticated connection string
- TLS in production
- retryable writes
- majority write concern for audit documents
- unique event IDs
- separate database responsibility from the financial source of truth

### Worker -> Blockchain

Controls:

- isolated ethers.js adapter
- chain ID validation
- explicit contract address
- HTTPS RPC in production
- pinned chain ID
- verified transaction calldata/value/sender/receiver before confirmation
- configurable confirmation-depth policy before marking a mined transaction CONFIRMED
- private key supplied only through secret configuration
- no secrets stored in Git

## Secret policy

Never commit:

- private keys
- seed phrases
- RPC API keys
- MySQL passwords
- MongoDB passwords
- production bearer tokens

Use managed secrets for deployment.

## Transaction safety

- Require idempotency keys.
- Keep the authoritative state in MySQL.
- Use transactional outbox writes.
- Reject invalid status transitions.
- Never mark a transaction CONFIRMED solely because an API request succeeded.
- Confirm blockchain receipts and confirmation depth before finalizing real-money workflows.

## Audit safety

MongoDB is a read/audit model, not the ledger.

If MongoDB is unavailable, the MySQL outbox retains the event for retry.

## Blockchain safety

The example contract is intentionally non-custodial and only anchors transaction metadata.

Before handling real funds, add:

- audited custody/signing architecture
- nonce management
- RPC failover
- chain allowlists
- gas/fee limits
- receipt verification
- confirmation-depth rules
- reorg handling
- reconciliation
- incident-response procedures


## Supply-chain safety

- GitHub Actions are pinned to immutable commit SHAs.
- CI disables automatic npm package-manager caching when no lockfile is present.
- Dependabot tracks npm, Actions and Docker updates.
- The production image is scanned for HIGH/CRITICAL vulnerabilities.
- The runtime image removes npm/npx after dependency installation to reduce the shipped tool surface.
- Application containers run without Linux capabilities, with no-new-privileges, a read-only root filesystem and a hardened temporary filesystem.

## Observability safety

The application exposes only an authenticated metrics endpoint. Metric labels use route templates and bounded categorical values; transaction identifiers, transaction hashes, request IDs, credentials, and payloads are not emitted as Prometheus label values. Worker telemetry is emitted as structured logs and passes through the same sanitization policy as other operational errors.

## Logging safety

Application and worker error messages pass through centralized redaction before being emitted or stored as retry metadata. Connection-string credentials, bearer tokens, common secret assignments and control characters are removed.
