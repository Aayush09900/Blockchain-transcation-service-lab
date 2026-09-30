# Railway Production Deployment

Railway is the intended public runtime for this repository when the API needs a real internet endpoint. Railway can deploy the repository's Dockerfile, and its project model maps Compose services to separate services with private networking. citeturn207388search0turn233801search8

## Services

Create one Railway project with:

- **MySQL** database service
- **MongoDB** database service
- **api** service from this GitHub repository
- **outbox-worker** service from the same repository
- **blockchain-confirmation-worker** service from the same repository

Railway provides MySQL and MongoDB database services/templates, and service-to-service variables can be referenced using \${{SERVICE.VAR}}. citeturn233801search7turn233801search9turn233801search0

## API service

Source: this GitHub repository, branch `main`.

Build: use the repository root `Dockerfile`.

Start command:

```text
node src/http-server.js
```

Set:

```text
NODE_ENV=production
PORT=3000
API_TOKEN=<long-random-secret>
MYSQL_URL=\${{MySQL.MYSQL_URL}}
MYSQL_SSL=true
MONGO_URL=<private MongoDB connection string>
MONGO_DATABASE=blockchain_transaction_audit
MONGO_MAX_POOL_SIZE=20
MONGO_TLS=true
BLOCKCHAIN_ENABLED=false
```

Generate a public domain for the API service. Railway services are not public by default; a domain must be generated in the service networking settings. citeturn233801search10

Set:

```text
CORS_ORIGIN=https://aayush09900.github.io
```

## MongoDB connection

Use the MongoDB service's private hostname and credentials. Keep MongoDB private; do not expose its database port publicly unless an operational requirement exists.

## Outbox worker

Create another service from the same repository.

Start command:

```text
node src/outbox-worker.js
```

Variables:

```text
NODE_ENV=production
MYSQL_URL=\${{MySQL.MYSQL_URL}}
MYSQL_SSL=true
MYSQL_POOL_MAX=10
MONGO_URL=<private MongoDB connection string>
MONGO_DATABASE=blockchain_transaction_audit
MONGO_MAX_POOL_SIZE=20
MONGO_TLS=true
OUTBOX_POLL_MS=1000
```

This service does not need a public domain.

## Blockchain confirmation worker

Create another service from the same repository.

Start command:

```text
node src/blockchain-confirmation-worker.js
```

Variables:

```text
NODE_ENV=production
MYSQL_URL=\${{MySQL.MYSQL_URL}}
MYSQL_SSL=true
MYSQL_POOL_MAX=10
CHAIN_RPC_URL=<Ethereum RPC URL>
CHAIN_ID=<network chain id>
CHAIN_CONFIRM_POLL_MS=3000
CHAIN_CONFIRM_BATCH_SIZE=50
ANCHOR_CONTRACT_ADDRESS=<deployed contract>
```

This worker is read-only against the blockchain and does not require the signer private key.

## Blockchain-enabled API

Only enable signing after the runtime, monitoring, and secrets are configured:

```text
BLOCKCHAIN_ENABLED=true
CHAIN_RPC_URL=<Ethereum RPC URL>
CHAIN_ID=<network chain id>
CHAIN_SIGNER_PRIVATE_KEY=<managed secret>
ANCHOR_CONTRACT_ADDRESS=<deployed contract>
```

The signer key must be stored as a Railway secret/variable, never in GitHub source.

## GitHub Actions

The repository contains a manual Railway deployment workflow:

```text
.github/workflows/deploy-railway.yml
```

Before running it, add these GitHub Actions secrets:

- `RAILWAY_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_API_SERVICE_ID`
- `RAILWAY_OUTBOX_SERVICE_ID`
- `RAILWAY_CONFIRMATION_SERVICE_ID`

Railway supports project-scoped `RAILWAY_TOKEN` for CI/CD deployments and the CLI can link to a project/environment non-interactively. citeturn105796search0turn105796search1turn105796search3

The workflow deploys the API, outbox worker, and confirmation worker separately from the same repository.

## Production verification

After deployment:

```text
GET https://<generated-api-domain>/health
GET https://<generated-api-domain>/ready
```

Then verify:

1. API accepts authenticated requests.
2. MySQL transaction rows are created.
3. Outbox events reach MongoDB.
4. Blockchain anchor returns `202` with a transaction hash when enabled.
5. Confirmation worker eventually moves the transaction to `CONFIRMED` after a successful receipt.

## Important boundary

GitHub Pages is the project's public documentation/dashboard.

Railway is the intended public runtime for the API and workers.

The repository is not a custody platform and should not be used with production user funds until nonce management, RPC failover, reorg handling, confirmation-depth policy, secrets management, observability, backup/restore, and an external security review are completed.
