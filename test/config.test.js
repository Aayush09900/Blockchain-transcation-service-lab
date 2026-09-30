import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("development configuration allows memory mode", () => {
  const config = loadConfig({
    NODE_ENV: "development",
    PORT: "3000",
    API_TOKEN: "",
    DATABASE_URL: "",
    DB_SSL: "false"
  });

  assert.equal(config.production, false);
  assert.equal(config.port, 3000);
  assert.equal(config.databaseUrl, "");
  assert.equal(config.dbSsl, false);
});

test("production configuration requires authentication and persistence", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "",
        DATABASE_URL: "postgresql://example",
        DB_SSL: "true"
      }),
    /API_TOKEN is required in production/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        API_TOKEN: "long-test-token",
        DATABASE_URL: "",
        DB_SSL: "true"
      }),
    /DATABASE_URL is required in production/
  );
});

test("production database TLS defaults on unless explicitly disabled", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "3000",
    API_TOKEN: "long-test-token",
    DATABASE_URL: "postgresql://example"
  });

  assert.equal(config.dbSsl, true);
});

test("invalid CORS origins are rejected", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "development",
        PORT: "3000",
        API_TOKEN: "",
        DATABASE_URL: "",
        CORS_ORIGIN: "javascript:alert(1)"
      }),
    /CORS_ORIGIN must use http or https/
  );
});
