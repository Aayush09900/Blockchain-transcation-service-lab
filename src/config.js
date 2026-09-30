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
  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  const corsOrigin = String(env.CORS_ORIGIN ?? "").trim();

  if (production && !apiToken) {
    const error = new Error("API_TOKEN is required in production");
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
  }

  if (production && !databaseUrl) {
    const error = new Error(
      "DATABASE_URL is required in production; in-memory persistence is development-only"
    );
    error.code = "CONFIG_ERROR";
    error.statusCode = 500;
    throw error;
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
    databaseUrl,
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
    dbPoolMax: positiveInteger(env.DB_POOL_MAX, "DB_POOL_MAX", 10),
    dbSsl: env.DB_SSL === "true"
  });
}
