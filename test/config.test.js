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
    /API_TOKEN is required in production/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "abcdefghijklmnopqrstuvwxyz1234567890ABCD",
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
        API_TOKEN: "abcdefghijklmnopqrstuvwxyz1234567890ABCD",
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
    API_TOKEN: "abcdefghijklmnopqrstuvwxyz1234567890ABCD",
    MYSQL_URL: "mysql://example",
    MONGO_URL: "mongodb://example",
    BLOCKCHAIN_ENABLED: "false"
  });

  assert.equal(config.mysqlSsl, true);
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
