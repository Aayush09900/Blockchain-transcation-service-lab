import { isAddress } from "ethers";

function positiveInteger(value, field, fallback) {
  const raw = String(value ?? fallback).trim();

  if (!/^\d+$/.test(raw)) {
    const error = new Error(`${field} must be a positive integer`);
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
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
  const chainRpcUrls = parseRpcUrls(
    env.CHAIN_RPC_URLS,
    env.CHAIN_RPC_URL
  );
  const chainRpcUrl = chainRpcUrls[0] ?? "";
  const chainId = env.CHAIN_ID ? Number(env.CHAIN_ID) : undefined;
  const anchorContractAddress = String(
    env.ANCHOR_CONTRACT_ADDRESS ?? ""
  ).trim();
  const signerPrivateKey = String(
    env.CHAIN_SIGNER_PRIVATE_KEY ?? ""
  ).trim();
  const chainConfirmations = env.CHAIN_CONFIRMATIONS
    ? Number(env.CHAIN_CONFIRMATIONS)
    : 1;
  const chainMaxFeePerGasWei = env.CHAIN_MAX_FEE_PER_GAS_WEI
    ? parseUint256String(env.CHAIN_MAX_FEE_PER_GAS_WEI, "CHAIN_MAX_FEE_PER_GAS_WEI")
    : "";
  const chainMaxPriorityFeePerGasWei = env.CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI
    ? parseUint256String(
        env.CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI,
        "CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI"
      )
    : "";
  const chainGasLimit = env.CHAIN_GAS_LIMIT
    ? parseUint256String(env.CHAIN_GAS_LIMIT, "CHAIN_GAS_LIMIT")
    : "";
  const chainSignerLockTimeoutSeconds = positiveInteger(
    env.CHAIN_SIGNER_LOCK_TIMEOUT_SECONDS,
    "CHAIN_SIGNER_LOCK_TIMEOUT_SECONDS",
    10
  );

  const mysqlSsl = booleanValue(env.MYSQL_SSL, production);
  const mongoTls = booleanValue(env.MONGO_TLS, production);

  if (production && apiToken.length < 32) {
    throw configError("API_TOKEN must contain at least 32 characters in production");
  }

  if (production && !mysqlUrl) {
    throw configError("MYSQL_URL is required in production");
  }

  if (production && !mongoUrl) {
    throw configError("MONGO_URL is required in production");
  }

  if (blockchainEnabled) {
    if (
      chainRpcUrls.length === 0 ||
      !anchorContractAddress ||
      !signerPrivateKey ||
      chainId === undefined
    ) {
      throw configError(
        "CHAIN_RPC_URL, CHAIN_ID, ANCHOR_CONTRACT_ADDRESS, and CHAIN_SIGNER_PRIVATE_KEY are required when blockchain is enabled"
      );
    }

    for (const rpcUrl of chainRpcUrls) {
      let parsedRpcUrl;

      try {
        parsedRpcUrl = new URL(rpcUrl);
      } catch {
        throw configError("CHAIN_RPC_URLS contains an invalid URL");
      }

      if (!["http:", "https:"].includes(parsedRpcUrl.protocol)) {
        throw configError("CHAIN_RPC_URLS must use http or https");
      }

      if (production && parsedRpcUrl.protocol !== "https:") {
        throw configError("CHAIN_RPC_URLS must use HTTPS in production");
      }
    }

    if (!Number.isInteger(chainId) || chainId < 1) {
      throw configError("CHAIN_ID must be a positive integer");
    }

    if (!Number.isInteger(chainConfirmations) || chainConfirmations < 1 || chainConfirmations > 1000) {
      throw configError("CHAIN_CONFIRMATIONS must be an integer between 1 and 1000");
    }

    if (!isAddress(anchorContractAddress)) {
      throw configError("ANCHOR_CONTRACT_ADDRESS must be a valid Ethereum address");
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(signerPrivateKey)) {
      throw configError("CHAIN_SIGNER_PRIVATE_KEY must be a 32-byte hex private key");
    }

    if (production && (!chainMaxFeePerGasWei || !chainMaxPriorityFeePerGasWei)) {
      throw configError(
        "CHAIN_MAX_FEE_PER_GAS_WEI and CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI are required in production when blockchain is enabled"
      );
    }

    if (
      chainMaxFeePerGasWei &&
      chainMaxPriorityFeePerGasWei &&
      BigInt(chainMaxPriorityFeePerGasWei) > BigInt(chainMaxFeePerGasWei)
    ) {
      throw configError(
        "CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI must be <= CHAIN_MAX_FEE_PER_GAS_WEI"
      );
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
    chainRpcUrls,
    chainId,
    chainConfirmations,
    chainMaxFeePerGasWei,
    chainMaxPriorityFeePerGasWei,
    chainGasLimit,
    chainSignerLockTimeoutSeconds,
    anchorContractAddress,
    signerPrivateKey
  });
}


function parseRpcUrls(primaryValue, fallbackValue) {
  const rawValues = [primaryValue, fallbackValue]
    .filter((value) => value !== undefined && value !== null)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Object.freeze([...new Set(rawValues)]);
}


function parseUint256String(value, field) {
  const raw = String(value).trim();

  if (!/^\d+$/.test(raw)) {
    throw configError(`${field} must be a decimal unsigned integer`);
  }

  try {
    const parsed = BigInt(raw);

    if (parsed < 0n || parsed > ((1n << 256n) - 1n)) {
      throw new Error();
    }

    return parsed.toString();
  } catch {
    throw configError(`${field} must be a valid uint256 decimal value`);
  }
}
