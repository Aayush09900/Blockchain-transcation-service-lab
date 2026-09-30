# Security Architecture

## Trust boundaries

### Internet -> API

Controls:

- TLS at deployment edge
- authentication
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
- retryable writes
- majority write concern for audit documents
- unique event IDs
- separate database responsibility from the financial source of truth

### Worker -> Blockchain

Controls:

- isolated ethers.js adapter
- chain ID validation
- explicit contract address
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
