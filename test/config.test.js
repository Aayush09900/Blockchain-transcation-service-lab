const testPrivateKey = `0x${"11".repeat(32)}`;

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("development configuration accepts MySQL and MongoDB settings", () => {
  const config = loadConfig({
    NODE_ENV: "development",
    PORT: "3000",
    API_TOKEN: "",
    MYSQL_URL: "mysql://user:pass@127.0.0.1:3306/db",
    MONGO_URL: "mongodb://127.0.0.1:27017",
    MYSQL_SSL: "false",
    BLOCKCHAIN_ENABLED: "false"
  });

  assert.equal(config.production, false);
  assert.equal(config.port, 3000);
  assert.equal(config.mysqlUrl.includes("mysql://"), true);
  assert.equal(config.mongoUrl.includes("mongodb://"), true);
  assert.equal(config.blockchainEnabled, false);
});

test("numeric configuration values reject malformed integers", () => {
  const base = {
    NODE_ENV: "development",
    API_TOKEN: "",
    MYSQL_URL: "",
    MONGO_URL: "",
    BLOCKCHAIN_ENABLED: "false"
  };

  for (const value of ["3000.5", "3000abc", "-1", "1e3"]) {
    assert.throws(
      () => loadConfig({ ...base, PORT: value }),
      /PORT must be a positive integer/
    );
  }

  const config = loadConfig({ ...base, PORT: " 3000 " });
  assert.equal(config.port, 3000);
});

test("production configuration requires authentication and both databases", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "",
        MYSQL_URL: "mysql://example",
        MONGO_URL: "mongodb://example",
        BLOCKCHAIN_ENABLED: "false"
      }),
    /API_TOKEN must contain at least 32 characters in production/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "long-test-token-123456789012345678901234",
        MYSQL_URL: "",
        MONGO_URL: "mongodb://example",
        BLOCKCHAIN_ENABLED: "false"
      }),
    /MYSQL_URL is required in production/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "long-test-token-123456789012345678901234",
        MYSQL_URL: "mysql://example",
        MONGO_URL: "",
        BLOCKCHAIN_ENABLED: "false"
      }),
    /MONGO_URL is required in production/
  );
});

test("production MySQL TLS defaults on unless explicitly disabled", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "3000",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "false"
  });

  assert.equal(config.mysqlSsl, true);
  assert.equal(config.mongoTls, true);
});

test("invalid CORS origins are rejected", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "3000",
        API_TOKEN: "",
        MYSQL_URL: "",
        MONGO_URL: "",
        CORS_ORIGIN: "javascript:alert(1)"
      }),
    /CORS_ORIGIN must use http or https/
  );
});

test("blockchain configuration is mandatory when enabled", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "3000",
        API_TOKEN: "",
        MYSQL_URL: "",
        MONGO_URL: "",
        BLOCKCHAIN_ENABLED: "true"
      }),
    /CHAIN_RPC_URL, CHAIN_ID, ANCHOR_CONTRACT_ADDRESS, and CHAIN_SIGNER_PRIVATE_KEY/
  );
});


test("production rejects short API tokens", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        API_TOKEN: "short-token-123",
        MYSQL_URL: "mysql://example",
        MONGO_URL: "mongodb://example",
        BLOCKCHAIN_ENABLED: "false"
      }),
    /at least 32 characters/
  );
});

test("blockchain mode requires a pinned chain ID and secure production RPC", () => {
  const base = {
    NODE_ENV: "production",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "true",
    CHAIN_RPC_URL: "http://rpc.example",
    CHAIN_ID: "11155111",
    ANCHOR_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    CHAIN_SIGNER_PRIVATE_KEY: testPrivateKey
  };

  assert.throws(
    () => loadConfig(base),
    /CHAIN_RPC_URLS must use HTTPS in production/
  );

  assert.throws(
    () => loadConfig({ ...base, CHAIN_RPC_URL: "https://rpc.example", CHAIN_ID: "" }),
    /CHAIN_RPC_URL, CHAIN_ID/
  );
});

test("production CORS origins must use HTTPS and cannot contain credentials", () => {
  const base = {
    NODE_ENV: "production",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "false"
  };

  assert.throws(
    () => loadConfig({ ...base, CORS_ORIGIN: "http://example.com" }),
    /CORS_ORIGIN must use HTTPS/
  );

  assert.throws(
    () => loadConfig({ ...base, CORS_ORIGIN: "https://user:pass@example.com" }),
    /must not contain credentials/
  );
});


test("blockchain RPC URLs are normalized and validated as a set", () => {
  const base = {
    NODE_ENV: "production",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "true",
    CHAIN_ID: "11155111",
    ANCHOR_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    CHAIN_SIGNER_PRIVATE_KEY: testPrivateKey
  };

  const config = loadConfig({
    ...base,
    CHAIN_RPC_URL: "https://primary.example",
    CHAIN_RPC_URLS:
      "https://primary.example, https://secondary.example,https://primary.example"
  });

  assert.deepEqual(config.chainRpcUrls, [
    "https://primary.example",
    "https://secondary.example"
  ]);
  assert.equal(config.chainRpcUrl, "https://primary.example");

  assert.throws(
    () =>
      loadConfig({
        ...base,
        CHAIN_RPC_URLS: "https://primary.example,http://secondary.example"
      }),
    /CHAIN_RPC_URLS must use HTTPS in production/
  );
});

test("production blockchain mode requires bounded fee policy", () => {
  const base = {
    NODE_ENV: "production",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "true",
    CHAIN_RPC_URL: "https://rpc.example",
    CHAIN_ID: "11155111",
    ANCHOR_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    CHAIN_SIGNER_PRIVATE_KEY: testPrivateKey
  };

  assert.throws(
    () => loadConfig(base),
    /CHAIN_MAX_FEE_PER_GAS_WEI and CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI are required/
  );

  const config = loadConfig({
    ...base,
    CHAIN_MAX_FEE_PER_GAS_WEI: "50000000000",
    CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI: "2000000000",
    CHAIN_GAS_LIMIT: "100000"
  });

  assert.equal(config.chainMaxFeePerGasWei, "50000000000");
  assert.equal(config.chainMaxPriorityFeePerGasWei, "2000000000");
  assert.equal(config.chainGasLimit, "100000");

  assert.throws(
    () =>
      loadConfig({
        ...base,
        CHAIN_MAX_FEE_PER_GAS_WEI: "100",
        CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI: "101"
      }),
    /must be <= CHAIN_MAX_FEE_PER_GAS_WEI/
  );

  assert.throws(
    () =>
      loadConfig({
        ...base,
        CHAIN_MAX_FEE_PER_GAS_WEI: "not-a-number",
        CHAIN_MAX_PRIORITY_FEE_PER_GAS_WEI: "2"
      }),
    /must be a decimal unsigned integer/
  );
});

test("blockchain confirmation depth defaults to one and is bounded", () => {
  const base = {
    NODE_ENV: "production",
    API_TOKEN: "long-test-token-123456789012345678901234",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "true",
    CHAIN_RPC_URL: "https://rpc.example",
    CHAIN_ID: "11155111",
    ANCHOR_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    CHAIN_SIGNER_PRIVATE_KEY: testPrivateKey
  };

  assert.equal(loadConfig(base).chainConfirmations, 1);
  assert.equal(
    loadConfig({ ...base, CHAIN_CONFIRMATIONS: "6" }).chainConfirmations,
    6
  );

  assert.throws(
    () => loadConfig({ ...base, CHAIN_CONFIRMATIONS: "0" }),
    /CHAIN_CONFIRMATIONS must be an integer between 1 and 1000/
  );

  assert.throws(
    () => loadConfig({ ...base, CHAIN_CONFIRMATIONS: "1001" }),
    /CHAIN_CONFIRMATIONS must be an integer between 1 and 1000/
  );
});
