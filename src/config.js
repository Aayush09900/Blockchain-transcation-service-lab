function positiveInteger(value, field, fallback) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    const error = new Error(`${field} must be a positive integer`);
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  return parsed;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return value === "true";
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";

  const port = positiveInteger(env.PORT, "PORT", 3000);

  if (port > 65535) {
    const error = new Error("PORT must be <= 65535");
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  const apiToken = String(env.API_TOKEN ?? "").trim();
  const mysqlUrl = String(env.MYSQL_URL ?? "").trim();
  const mongoUrl = String(env.MONGO_URL ?? "").trim();
  const mongoDatabase = String(
    env.MONGO_DATABASE ?? "blockchain_transaction_audit"
  ).trim();
  const corsOrigin = String(env.CORS_ORIGIN ?? "").trim();

  const blockchainEnabled = booleanValue(
    env.BLOCKCHAIN_ENABLED,
    false
  );
  const chainRpcUrl = String(env.CHAIN_RPC_URL ?? "").trim();
  const chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : undefined;
  const anchorContractAddress = String(
    env.ANCHOR_CONTRACT_ADDRESS ?? ""
  ).trim();
  const signerPrivateKey = String(
    env.CHAIN_SIGNER_PRIVATE_KEY ?? ""
  ).trim();
  const mysqlSsl = booleanValue(env.MYSQL_SSL, production);

  if (production && !apiToken) {
    const error = new Error("API_TOKEN is required in production");
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  if (production && !mysqlUrl) {
    const error = new Error(
      "MYSQL_URL is required in production"
    );
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  if (production && !mongoUrl) {
    const error = new Error(
      "MONGO_URL is required in production"
    );
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  if (blockchainEnabled) {
    if (!chainRpcUrl || !anchorContractAddress || !signerPrivateKey) {
      const error = new Error(
        "CHAIN_RPC_URL, ANCHOR_CONTRACT_ADDRESS, and CHAIN_SIGNER_PRIVATE_KEY are required when blockchain is enabled"
      );
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    if (chainId !== undefined && (!Number.isInteger(chainId) || chainId < 1)) {
      const error = new Error("CHAIN_ID must be a positive integer");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }
  }

  if (corsOrigin) {
    let origin;

    try {
      origin = new URL(corsOrigin);
    } catch {
      const error = new Error("CORS_ORIGIN must be a valid URL");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    if (!["http:", "https:"].includes(origin.protocol)) {
      const error = new Error("CORS_ORIGIN must use http or https");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }
  }

  return Object.freeze({
    nodeEnv,
    production,
    port,
    apiToken,
    mysqlUrl,
    mongoUrl,
    mongoDatabase,
    corsOrigin,
    rateLimitMax: positiveInteger(
      env.RATE_LIMIT_MAX,
      "RATE_LIMIT_MAX",
      60
    ),
    rateLimitMaxClients: positiveInteger(
      env.RATE_LIMIT_MAX_CLIENTS,
      "RATE_LIMIT_MAX_CLIENTS",
      10_000
    ),
    mysqlPoolMax: positiveInteger(
      env.MYSQL_POOL_MAX,
      "MYSQL_POOL_MAX",
      10
    ),
    mysqlSsl,
    mongoMaxPoolSize: positiveInteger(
      env.MONGO_MAX_POOL_SIZE,
      "MONGO_MAX_POOL_SIZE",
      20
    ),
    blockchainEnabled,
    chainRpcUrl,
    chainId,
    anchorContractAddress,
    signerPrivateKey
  });
}
