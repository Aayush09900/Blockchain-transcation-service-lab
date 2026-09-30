import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";

export default defineConfig({
  plugins: [hardhatEthers],

  paths: {
    tests: "./hardhat-tests"
  },

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10_000
          }
        }
      }
    }
  },

  test: {
    solidity: {
      profiles: {
        default: {
          isolate: true,
          fuzz: {
            runs: 256
          }
        },
        ci: {
          isolate: true,
          fuzz: {
            runs: 1_000
          }
        }
      }
    }
  }
});
