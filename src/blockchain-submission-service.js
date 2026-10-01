import { parseEther } from "ethers";
import { validateTransactionHash } from "./validation.js";

export async function submitViaBlockchain({
  transaction,
  blockchain,
  transitionTransaction,
  withSubmissionLock = null
}) {
  if (!transaction) {
    const error = new Error("transaction not found");
    error.code = "NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  // Repeated submit requests are idempotent. Once execution has started,
  // callers observe the authoritative state instead of triggering a second
  // broadcast.
  if (transaction.status !== "CREATED") {
    return {
      transaction,
      blockchain: null,
      reused: true
    };
  }

  if (!blockchain) {
    const error = new Error("blockchain adapter disabled");
    error.code = "BLOCKCHAIN_DISABLED";
    error.statusCode = 503;
    throw error;
  }

  // Claim the signer lock before changing state. If the lock is unavailable,
  // the transaction stays CREATED and a later request can retry safely.
  // Re-read authoritative state after acquiring the lock to eliminate
  // duplicate broadcasts from concurrent callers using stale snapshots.
  const executeBroadcast = async () => {
    const current = getTransaction
      ? await getTransaction(transaction.id)
      : transaction;

    if (current.status !== "CREATED") {
      return {
        transaction: current,
        blockchain: null,
        reused: true
      };
    }

    const broadcasting = await transitionTransaction(
      current.id,
      "BROADCASTING"
    );

    let broadcastResult;

    try {
      broadcastResult = await blockchain.broadcastAnchorTransaction({
        transactionId: broadcasting.id,
        sender: broadcasting.from,
        receiver: broadcasting.to,
        amountWei: parseEther(broadcasting.amount)
      });

      validateTransactionHash(broadcastResult?.txHash);
    } catch (cause) {
      if (cause?.code === "BLOCKCHAIN_FEE_POLICY_EXCEEDED") {
        throw cause;
      }

      const error = new Error(
        "blockchain broadcast outcome is unknown; transaction remains BROADCASTING"
      );
      error.code = "BLOCKCHAIN_BROADCAST_UNKNOWN";
      error.statusCode = 503;
      error.cause = cause;
      throw error;
    }

    let submitted;

    try {
      submitted = await transitionTransaction(
        broadcasting.id,
        "SUBMITTED",
        { txHash: broadcastResult.txHash }
      );
    } catch (cause) {
      // The chain may already have accepted the transaction. If durable
      // persistence of its hash fails, keep the outcome UNKNOWN so
      // reconciliation can recover the transaction instead of creating
      // a false negative.
      const error = new Error(
        "blockchain broadcast outcome is unknown; transaction remains BROADCASTING"
      );
      error.code = "BLOCKCHAIN_BROADCAST_UNKNOWN";
      error.statusCode = 503;
      error.cause = cause;
      throw error;
    }

    return {
      transaction: submitted,
      blockchain: broadcastResult,
      reused: false
    };
  };

  return withSubmissionLock
    ? withSubmissionLock(executeBroadcast)
    : executeBroadcast();
}
