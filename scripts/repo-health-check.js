import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = process.cwd();

const requiredFiles = [
  "package.json",
  "README.md",
  "SECURITY.md",
  "SECURITY-TEST-REPORT.md",
  "Dockerfile",
  "docker-compose.yml",
  "db/mysql/001_init.sql",
  "src/http-server.js",
  "src/http-errors.js",
  "src/path-security.js",
  "src/mysql-store.js",
  "src/security.js",
  "src/transaction-service.js",
  "src/mongo-audit-store.js",
  "src/blockchain-adapter.js",
  "src/outbox-worker.js",
  "src/blockchain-confirmation-worker.js",
  "hardhat.config.js",
  "contracts/TransactionReceiptAnchor.sol",
  "hardhat-tests/TransactionReceiptAnchor.test.js",
  "src/validation.js",
  "test/transaction-service.test.js",
  "test/config.test.js",
  "test/mysql-store.integration.test.js",
  "test/mongo-audit-store.integration.test.js",
  "test/security-vulnerabilities.test.js",
  ".github/workflows/ci.yml",
  ".github/workflows/security.yml",
  ".github/workflows/publish-image.yml"
];

const failures = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

for (const file of requiredFiles) {
  if (!exists(file)) {
    failures.push(`missing required file: ${file}`);
  }
}

const packageJsonPath = path.join(root, "package.json");
if (exists("package.json")) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  for (const script of ["test", "start", "start:core", "start:outbox", "start:confirm-worker"]) {
    if (!pkg.scripts?.[script]) {
      failures.push(`missing npm script: ${script}`);
    }
  }

  for (const dependency of ["mysql2", "mongodb", "ethers"]) {
    if (!pkg.dependencies?.[dependency]) {
      failures.push(`missing runtime dependency: ${dependency}`);
    }
  }

  for (const dependency of ["hardhat", "@nomicfoundation/hardhat-ethers", "@nomicfoundation/hardhat-mocha"]) {
    if (!pkg.devDependencies?.[dependency]) {
      failures.push(`missing development dependency: ${dependency}`);
    }
  }
}

const compose = exists("docker-compose.yml")
  ? fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8")
  : "";

for (const forbidden of [
  "change-this-password",
  "change-this-api-token",
  "password=secret",
  "privateKey=",
  "PRIVATE_KEY="
]) {
  if (compose.includes(forbidden)) {
    failures.push(`possible hardcoded secret in docker-compose.yml: ${forbidden}`);
  }
}

if (exists(".env")) {
  failures.push(".env must not exist in the repository");
}

const gitignore = exists(".gitignore")
  ? fs.readFileSync(path.join(root, ".gitignore"), "utf8")
  : "";

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(?:aws_secret_access_key|private_key|seed_phrase)\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{16,}/i
];

for (const file of trackedFiles) {
  if (
    file === ".env.example" ||
    file.includes("node_modules/") ||
    file.endsWith(".lock")
  ) {
    continue;
  }

  const absolute = path.join(root, file);

  if (!fs.existsSync(absolute)) continue;

  const text = fs.readFileSync(absolute, "utf8");

  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      failures.push(`possible secret material in tracked file: ${file}`);
      break;
    }
  }
}

for (const requiredIgnore of [".env", "*.pem", "*.key", "node_modules/"]) {
  if (!gitignore.includes(requiredIgnore)) {
    failures.push(`.gitignore missing protection for ${requiredIgnore}`);
  }
}

if (failures.length > 0) {
  console.error("Repository health check failed:");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log("Repository health check passed.");
console.log(`Checked ${requiredFiles.length} required paths and security invariants.`);
