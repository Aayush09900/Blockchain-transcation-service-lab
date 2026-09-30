import { parseEther } from "ethers";
import { validateTransactionHash } from "./validation.js";

export async function submitViaBlockchain({
  transaction,
  blockchain,
  transitionTransaction
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

  // Persist BROADCASTING before touching the chain. If the process crashes
  // after the chain accepts the transaction, the recovery worker can search
  // the indexed anchor event by transaction ID and recover the tx hash.
  const broadcasting = await transitionTransaction(
    transaction.id,
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

    const submitted = await transitionTransaction(
      broadcasting.id,
      "SUBMITTED",
      { txHash: broadcastResult.txHash }
    );

    return {
      transaction: submitted,
      blockchain: broadcastResult,
      reused: false
    };
  } catch (cause) {
    // At this point the signer/RPC may have accepted the transaction even if
    // the request timed out or persistence failed. Never convert that
    // ambiguity into FAILED; BROADCASTING is the durable reconciliation state.
    const error = new Error(
      "blockchain broadcast outcome is unknown; transaction remains BROADCASTING"
    );
    error.code = "BLOCKCHAIN_BROADCAST_UNKNOWN";
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
}
