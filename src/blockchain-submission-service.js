import { parseEther } from "ethers";
import { sanitizeError } from "./logging.js";
import { validateTransactionHash } from "./validation.js";

const STATUS = Object.freeze({
  CREATED: "CREATED",
  BROADCASTING: "BROADCASTING",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED"
});

const DEFINITIVE_BROADCAST_ERRORS = new Set([
  "ACTION_REJECTED",
  "CALL_EXCEPTION",
  "INSUFFICIENT_FUNDS",
  "INVALID_ARGUMENT",
  "MISSING_ARGUMENT",
  "UNEXPECTED_ARGUMENT",
  "UNPREDICTABLE_GAS_LIMIT"
]);

export class BlockchainSubmissionService {
  constructor({ store, blockchain }) {
    if (!store) {
      throw new Error("transaction store is required");
    }

    if (!blockchain) {
      throw new Error("blockchain adapter is required");
    }

    this.store = store;
    this.blockchain = blockchain;
  }

  async submit(id) {
    let transaction = await this.store.get(id);

    if (transaction.status !== STATUS.CREATED) {
      return this.#existingSubmission(transaction);
    }

    let broadcasting;

    try {
      broadcasting = await this.store.transition(id, STATUS.BROADCASTING);
    } catch (error) {
      if (error?.code !== "INVALID_TRANSITION") {
        throw error;
      }

      transaction = await this.store.get(id);

      if (transaction.status !== STATUS.CREATED) {
        return this.#existingSubmission(transaction);
      }

      throw error;
    }

    try {
      const blockchainResult =
        await this.blockchain.broadcastAnchorTransaction({
          transactionId: broadcasting.id,
          sender: broadcasting.from,
          receiver: broadcasting.to,
          amountWei: parseEther(broadcasting.amount)
        });

      const submitted = await this.store.transition(
        broadcasting.id,
        STATUS.SUBMITTED,
        { txHash: validateTransactionHash(blockchainResult.txHash) }
      );

      return {
        transaction: submitted,
        blockchain: blockchainResult,
        outcome: "SUBMITTED"
      };
    } catch (error) {
      if (isDefinitiveBroadcastFailure(error)) {
        const failed = await this.store.transition(
          broadcasting.id,
          STATUS.FAILED,
          {
            failureReason: sanitizeError(error)
          }
        );

        const failure = new Error("blockchain broadcast rejected");
        failure.code = "BLOCKCHAIN_BROADCAST_REJECTED";
        failure.statusCode = 502;
        failure.transaction = failed;
        failure.cause = error;
        throw failure;
      }

      return {
        transaction: await this.store.get(broadcasting.id),
        outcome: "BROADCASTING",
        reconciliationRequired: true,
        error
      };
    }
  }

  async reconcile(id, txHash) {
    const normalizedHash = validateTransactionHash(txHash);
    let transaction = await this.store.get(id);

    if (transaction.status === STATUS.CONFIRMED) {
      return {
        transaction,
        outcome: "CONFIRMED"
      };
    }

    if (transaction.status === STATUS.FAILED) {
      const error = new Error("failed transactions cannot be reconciled");
      error.code = "INVALID_TRANSITION";
      error.statusCode = 409;
      throw error;
    }

    if (transaction.status === STATUS.CREATED) {
      const error = new Error(
        "transaction must be submitted or broadcasting before reconciliation"
      );
      error.code = "INVALID_TRANSITION";
      error.statusCode = 409;
      throw error;
    }

    const verification =
      await this.blockchain.verifySubmittedTransaction({
        transactionId: transaction.id,
        sender: transaction.from,
        receiver: transaction.to,
        amountWei: parseEther(transaction.amount),
        txHash: normalizedHash
      });

    if (verification.reverted) {
      const failed = await this.store.transition(
        transaction.id,
        STATUS.FAILED,
        { failureReason: "blockchain transaction reverted" }
      );

      return {
        transaction: failed,
        outcome: "FAILED"
      };
    }

    if (transaction.status === STATUS.BROADCASTING) {
      transaction = await this.store.transition(
        transaction.id,
        STATUS.SUBMITTED,
        { txHash: normalizedHash }
      );
    }

    if (!verification.confirmed) {
      return {
        transaction,
        outcome: "SUBMITTED",
        reconciliationRequired: true
      };
    }

    const confirmed = await this.store.transition(
      transaction.id,
      STATUS.CONFIRMED
    );

    return {
      transaction: confirmed,
      outcome: "CONFIRMED",
      verification
    };
  }

  #existingSubmission(transaction) {
    if (transaction.status === STATUS.BROADCASTING) {
      return {
        transaction,
        outcome: "BROADCASTING",
        reconciliationRequired: true
      };
    }

    if (transaction.status === STATUS.SUBMITTED) {
      return {
        transaction,
        outcome: "SUBMITTED"
      };
    }

    if (transaction.status === STATUS.CONFIRMED) {
      return {
        transaction,
        outcome: "CONFIRMED"
      };
    }

    if (transaction.status === STATUS.FAILED) {
      const error = new Error("transaction has already failed");
      error.code = "INVALID_TRANSITION";
      error.statusCode = 409;
      throw error;
    }

    return {
      transaction,
      outcome: transaction.status
    };
  }
}

function isDefinitiveBroadcastFailure(error) {
  return DEFINITIVE_BROADCAST_ERRORS.has(error?.code);
}
