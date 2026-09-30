import { isAddress } from "ethers";

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

function configError(message) {
  const error = new Error(message);
  error.code = "CONFIG_ERROR";
  error.statusCode = 500;
  return error;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";

  const port = positiveInteger(env.PORT, "PORT", 3000);

  if (port > 65535) {
    throw configError("PORT must be <= 65535");
  }

  const apiToken = String(env.API_TOKEN ?? "").trim();
  const mysqlUrl = String(env.MYSQL_URL ?? "").trim();
  const mongoUrl = String(env.MONGO_URL ?? "").trim();
  const mongoDatabase = String(
    env.MONGO_DATABASE ?? "blockchain_transaction_audit"
  ).trim();
  const corsOrigin = String(env.CORS_ORIGIN ?? "").trim();

  const blockchainEnabled = booleanValue(env.BLOCKCHAIN_ENABLED, false);
  const chainRpcUrl = String(env.CHAIN_RPC_URL ?? "").trim();
  const chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : undefined;
  const anchorContractAddress = String(
    env.ANCHOR_CONTRACT_ADDRESS ?? ""
  ).trim();
  const signerPrivateKey = String(
    env.CHAIN_SIGNER_PRIVATE_KEY ?? ""
  ).trim();

  const mysqlSsl = booleanValue(env.MYSQL_SSL, production);
  const mongoTls = booleanValue(env.MONGO_TLS, production);

  if (production && apiToken.length < 32) {
    throw configError("API_TOKEN must contain at least 32 characters in production");
  }

  if (production && apiToken.length < 32) {
    const error = new Error("API_TOKEN must contain at least 32 characters in production");
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  if (production && !mysqlUrl) {
    throw configError("MYSQL_URL is required in production");
  }

  if (production && !mongoUrl) {
    throw configError("MONGO_URL is required in production");
  }

  if (blockchainEnabled) {
    if (!chainRpcUrl || !anchorContractAddress || !signerPrivateKey || chainId === undefined) {
      throw configError(
        "CHAIN_RPC_URL, CHAIN_ID, ANCHOR_CONTRACT_ADDRESS, and CHAIN_SIGNER_PRIVATE_KEY are required when blockchain is enabled"
      );
    }

    let parsedRpcUrl;
    try {
      parsedRpcUrl = new URL(chainRpcUrl);
    } catch {
      throw configError("CHAIN_RPC_URL must be a valid URL");
    }

    if (!["http:", "https:"].includes(parsedRpcUrl.protocol)) {
      throw configError("CHAIN_RPC_URL must use http or https");
    }

    if (production && parsedRpcUrl.protocol !== "https:") {
      throw configError("CHAIN_RPC_URL must use HTTPS in production");
    }

    if (!Number.isInteger(chainId) || chainId < 1) {
      throw configError("CHAIN_ID must be a positive integer");
    }

    if (!isAddress(anchorContractAddress)) {
      throw configError("ANCHOR_CONTRACT_ADDRESS must be a valid Ethereum address");
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(signerPrivateKey)) {
      throw configError("CHAIN_SIGNER_PRIVATE_KEY must be a 32-byte hex private key");
    }
  }

  if (corsOrigin) {
    let origin;

    try {
      origin = new URL(corsOrigin);
    } catch {
      throw configError("CORS_ORIGIN must be a valid URL");
    }

    if (!["http:", "https:"].includes(origin.protocol)) {
      throw configError("CORS_ORIGIN must use http or https");
    }

    if (production && origin.protocol !== "https:") {
      throw configError("CORS_ORIGIN must use HTTPS in production");
    }

    if (origin.username || origin.password) {
      throw configError("CORS_ORIGIN must not contain credentials");
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
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, "RATE_LIMIT_MAX", 60),
    rateLimitMaxClients: positiveInteger(
      env.RATE_LIMIT_MAX_CLIENTS,
      "RATE_LIMIT_MAX_CLIENTS",
      10_000
    ),
    mysqlPoolMax: positiveInteger(env.MYSQL_POOL_MAX, "MYSQL_POOL_MAX", 10),
    mysqlSsl,
    mongoTls,
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
