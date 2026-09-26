# Security

This repository is a learning lab.

## Rules

- Never commit private keys, seed phrases, RPC secrets, API credentials, or production wallet material.
- Do not connect this service to real-fund custody without independent security review.
- Treat transaction state as untrusted until confirmed from the chain.
- Keep idempotency keys scoped to a client request and protected from accidental reuse.
- Add authorization, durable storage, rate limiting, and audit controls before production use.

## Reporting

For a real security issue, use a private disclosure channel rather than publishing secrets or exploit details in a public issue.
