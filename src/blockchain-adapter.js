import {
  Contract,
  Interface,
  FallbackProvider,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  getAddress,
  getBytes,
  id,
  isAddress
} from "ethers";
import {
  buildTransactionOverrides,
  parseOptionalGasLimit,
  parseOptionalGwei
} from "./blockchain-fee-policy.js";

const ABI = [
  "function anchor(bytes32 transactionId, address sender, address receiver, uint256 amount)",
  "function getAnchor(bytes32 transactionId) view returns (address sender, address receiver, uint256 amount, uint64 blockNumber, uint64 timestamp)",
  "event TransactionAnchored(bytes32 indexed transactionId, address indexed sender, address indexed receiver, uint256 amount, uint256 blockNumber, uint256 timestamp)"
];

const CONTRACT_INTERFACE = new Interface(ABI);

export class EthersBlockchainAdapter {
  constructor({
    provider,
    signer,
    contractAddress,
    confirmationDepth = 1,
    gasLimit = null,
    maxFeePerGas = null,
    maxPriorityFeePerGas = null
  }) {
    if (!provider) {
      throw new Error("ethers provider is required");
    }

    if (!signer) {
      throw new Error("ethers signer is required");
    }

    if (!isAddress(contractAddress)) {
      throw new Error("valid anchor contract address is required");
    }

    const normalizedConfirmationDepth = Number(confirmationDepth);

    if (
      !Number.isInteger(normalizedConfirmationDepth) ||
      normalizedConfirmationDepth < 1 ||
      normalizedConfirmationDepth > 1000
    ) {
      throw new Error("confirmationDepth must be an integer between 1 and 1000");
    }

    this.provider = provider;
    this.signer =
      signer instanceof NonceManager ? signer : new NonceManager(signer);
    this.confirmationDepth = normalizedConfirmationDepth;
    this.gasLimit =
      gasLimit === null || gasLimit === undefined
        ? null
        : BigInt(gasLimit);
    this.maxFeePerGas = maxFeePerGas;
    this.maxPriorityFeePerGas = maxPriorityFeePerGas;
    this.transactionOverrides = buildTransactionOverrides({
      gasLimit: this.gasLimit,
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas
    });
    this.contractAddress = getAddress(contractAddress);
    this.contract = new Contract(this.contractAddress, ABI, this.signer);
  }

  static fromConfig({
    rpcUrl = process.env.CHAIN_RPC_URL,
    rpcUrls = process.env.CHAIN_RPC_URLS,
    privateKey = process.env.CHAIN_SIGNER_PRIVATE_KEY,
    contractAddress = process.env.ANCHOR_CONTRACT_ADDRESS,
    chainId,
    confirmationDepth = process.env.CHAIN_CONFIRMATIONS ?? "1",
    gasLimit = parseOptionalGasLimit(process.env.CHAIN_GAS_LIMIT),
    maxFeePerGas = parseOptionalGwei(
      process.env.CHAIN_MAX_FEE_GWEI,
      "CHAIN_MAX_FEE_GWEI"
    ),
    maxPriorityFeePerGas = parseOptionalGwei(
      process.env.CHAIN_MAX_PRIORITY_FEE_GWEI,
      "CHAIN_MAX_PRIORITY_FEE_GWEI"
    )
  } = {}) {
    if (!privateKey || !contractAddress) {
      throw new Error(
        "CHAIN_RPC_URL or CHAIN_RPC_URLS, CHAIN_SIGNER_PRIVATE_KEY and ANCHOR_CONTRACT_ADDRESS are required"
      );
    }

    const provider = createRpcProvider({
      rpcUrl,
      rpcUrls,
      chainId
    });

    const signer = new Wallet(privateKey, provider);

    return new EthersBlockchainAdapter({
      provider,
      signer,
      contractAddress,
      confirmationDepth,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    });
  }

  async healthCheck(expectedChainId) {
    const network = await this.provider.getNetwork();

    if (
      expectedChainId !== undefined &&
      network.chainId !== BigInt(expectedChainId)
    ) {
      throw new Error(
        `chain id mismatch: expected ${expectedChainId}, got ${network.chainId}`
      );
    }

    return true;
  }

  async broadcastAnchorTransaction({
    transactionId,
    sender,
    receiver,
    amountWei
  }) {
    const bytes32Id = transactionIdToBytes32(transactionId);

    const transaction = await this.contract.anchor(
      bytes32Id,
      sender,
      receiver,
      BigInt(amountWei),
      this.transactionOverrides
    );

    return {
      txHash: transaction.hash,
      transactionId,
      chainId: (await this.provider.getNetwork()).chainId.toString()
    };
  }

  async verifySubmittedTransaction({
    transactionId,
    sender,
    receiver,
    amountWei,
    txHash
  }) {
    validateTransactionHash(txHash);

    const [transaction, receipt] = await Promise.all([
      this.provider.getTransaction(txHash),
      this.provider.getTransactionReceipt(txHash)
    ]);

    if (!transaction) {
      const error = new Error("blockchain transaction not found");
      error.code = "BLOCKCHAIN_VERIFICATION_FAILED";
      error.statusCode = 409;
      throw error;
    }

    if (!receipt) {
      return { confirmed: false, receipt: null };
    }

    if (receipt.status !== 1) {
      return {
        confirmed: false,
        reverted: true,
        receipt: {
          txHash: receipt.hash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash
        }
      };
    }

    const currentBlock = await this.provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber + 1;

    if (confirmations < this.confirmationDepth) {
      return {
        confirmed: false,
        confirmations,
        requiredConfirmations: this.confirmationDepth,
        receipt: {
          txHash: receipt.hash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash
        }
      };
    }

    if (!transaction.to) {
      throw blockchainVerificationError("transaction has no destination");
    }

    const normalizedSender = getAddress(sender);
    const normalizedReceiver = getAddress(receiver);
    const normalizedTo = getAddress(transaction.to);

    if (normalizedTo === this.contractAddress) {
      const parsed = CONTRACT_INTERFACE.parseTransaction({
        data: transaction.data,
        value: transaction.value
      });

      if (!parsed || parsed.name !== "anchor") {
        throw blockchainVerificationError("unexpected anchor contract call");
      }

      const [encodedId, encodedSender, encodedReceiver, encodedAmount] = parsed.args;

      if (
        encodedId !== transactionIdToBytes32(transactionId) ||
        getAddress(encodedSender) !== normalizedSender ||
        getAddress(encodedReceiver) !== normalizedReceiver ||
        BigInt(encodedAmount) !== BigInt(amountWei)
      ) {
        throw blockchainVerificationError("anchor payload does not match transaction");
      }
    } else {
      if (
        normalizedTo !== normalizedReceiver ||
        transaction.from === null ||
        getAddress(transaction.from) !== normalizedSender ||
        BigInt(transaction.value) !== BigInt(amountWei)
      ) {
        throw blockchainVerificationError("transfer does not match transaction");
      }
    }

    return {
      confirmed: true,
      receipt: {
        txHash: receipt.hash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash
      }
    };
  }

  async anchorTransaction({
    transactionId,
    sender,
    receiver,
    amountWei
  }) {
    const broadcast = await this.broadcastAnchorTransaction({
      transactionId,
      sender,
      receiver,
      amountWei
    });

    const receipt = await this.provider.waitForTransaction(broadcast.txHash);

    if (!receipt || receipt.status !== 1) {
      throw new Error("blockchain transaction failed");
    }

    return {
      ...broadcast,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash
    };
  }

  async verifyConfirmedTransaction({
    txHash,
    confirmedBlockNumber,
    confirmedBlockHash
  }) {
    validateTransactionHash(txHash);

    const normalizedExpectedHash = String(confirmedBlockHash).toLowerCase();
    const canonicalBlock = await this.provider.getBlock(Number(confirmedBlockNumber));

    if (!canonicalBlock) {
      const error = new Error("canonical block could not be read for reorg validation");
      error.code = "BLOCKCHAIN_REORG_CHECK_UNAVAILABLE";
      error.statusCode = 503;
      throw error;
    }

    if (String(canonicalBlock.hash).toLowerCase() !== normalizedExpectedHash) {
      return { reorged: true, reason: "confirmed block no longer matches canonical evidence" };
    }

    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return {
        reorged: false,
        verified: false,
        reason: "receipt temporarily unavailable while canonical block remains unchanged"
      };
    }

    const normalizedReceiptHash = String(receipt.blockHash).toLowerCase();

    if (
      receipt.status !== 1 ||
      receipt.blockNumber !== Number(confirmedBlockNumber) ||
      normalizedReceiptHash !== normalizedExpectedHash
    ) {
      return {
        reorged: true,
        reason: "confirmed receipt no longer matches canonical evidence"
      };
    }

    return { reorged: false, verified: true };
  }

  async getTransactionReceipt(txHash) {
    validateTransactionHash(txHash);

    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return null;
    }

    return {
      txHash: receipt.hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash
    };
  }

  async getAnchor(transactionId) {
    const result = await this.contract.getAnchor(
      transactionIdToBytes32(transactionId)
    );

    return {
      sender: result[0],
      receiver: result[1],
      amountWei: result[2].toString(),
      blockNumber: Number(result[3]),
      timestamp: Number(result[4])
    };
  }
}

export class EthersReceiptMonitor {
  constructor({ provider, confirmationDepth = 1 }) {
    if (!provider) {
      throw new Error("ethers provider is required");
    }

    const normalizedConfirmationDepth = Number(confirmationDepth);

    if (
      !Number.isInteger(normalizedConfirmationDepth) ||
      normalizedConfirmationDepth < 1 ||
      normalizedConfirmationDepth > 1000
    ) {
      throw new Error("confirmationDepth must be an integer between 1 and 1000");
    }

    this.provider = provider;
    this.confirmationDepth = normalizedConfirmationDepth;
  }

  static fromConfig({
    rpcUrl = process.env.CHAIN_RPC_URL,
    rpcUrls = process.env.CHAIN_RPC_URLS,
    chainId,
    confirmationDepth = process.env.CHAIN_CONFIRMATIONS ?? "1"
  } = {}) {
    const provider = createRpcProvider({
      rpcUrl,
      rpcUrls,
      chainId
    });

    return new EthersReceiptMonitor({ provider, confirmationDepth });
  }

  async healthCheck(expectedChainId) {
    const network = await this.provider.getNetwork();

    if (
      expectedChainId !== undefined &&
      network.chainId !== BigInt(expectedChainId)
    ) {
      throw new Error(
        `chain id mismatch: expected ${expectedChainId}, got ${network.chainId}`
      );
    }

    return true;
  }


  async verifySubmittedTransaction({
    transactionId,
    sender,
    receiver,
    amountWei,
    txHash,
    anchorContractAddress
  }) {
    validateTransactionHash(txHash);

    const [transaction, receipt] = await Promise.all([
      this.provider.getTransaction(txHash),
      this.provider.getTransactionReceipt(txHash)
    ]);

    if (!transaction) {
      throw blockchainVerificationError("blockchain transaction not found");
    }

    if (!receipt) {
      return { confirmed: false, receipt: null };
    }

    if (receipt.status !== 1) {
      return { confirmed: false, reverted: true, receipt };
    }

    const currentBlock = await this.provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber + 1;

    if (confirmations < this.confirmationDepth) {
      return {
        confirmed: false,
        confirmations,
        requiredConfirmations: this.confirmationDepth,
        receipt
      };
    }

    if (!transaction.to) {
      throw blockchainVerificationError("transaction has no destination");
    }

    const normalizedSender = getAddress(sender);
    const normalizedReceiver = getAddress(receiver);
    const normalizedTo = getAddress(transaction.to);
    const normalizedAnchor = anchorContractAddress
      ? getAddress(anchorContractAddress)
      : null;

    if (normalizedAnchor && normalizedTo === normalizedAnchor) {
      const parsed = CONTRACT_INTERFACE.parseTransaction({
        data: transaction.data,
        value: transaction.value
      });

      if (!parsed || parsed.name !== "anchor") {
        throw blockchainVerificationError("unexpected anchor contract call");
      }

      const [
        encodedId,
        encodedSender,
        encodedReceiver,
        encodedAmount
      ] = parsed.args;

      if (
        encodedId !== transactionIdToBytes32(transactionId) ||
        getAddress(encodedSender) !== normalizedSender ||
        getAddress(encodedReceiver) !== normalizedReceiver ||
        BigInt(encodedAmount) !== BigInt(amountWei)
      ) {
        throw blockchainVerificationError("anchor payload does not match transaction");
      }
    } else if (
      normalizedTo !== normalizedReceiver ||
      transaction.from === null ||
      getAddress(transaction.from) !== normalizedSender ||
      BigInt(transaction.value) !== BigInt(amountWei)
    ) {
      throw blockchainVerificationError("transfer does not match transaction");
    }

    return { confirmed: true, receipt };
  }

  async findAnchorTransaction({
    transactionId,
    contractAddress = this.contractAddress,
    lookbackBlocks = 20_000
  }) {
    const normalizedContract = getAddress(contractAddress);
    const latestBlock = await this.provider.getBlockNumber();
    const safeLookback = Math.max(1, Math.min(Number(lookbackBlocks) || 20_000, 2_000_000));
    const fromBlock = Math.max(0, latestBlock - safeLookback);

    const topic = CONTRACT_INTERFACE.getEvent("TransactionAnchored").topicHash;
    const logs = await this.provider.getLogs({
      address: normalizedContract,
      fromBlock,
      toBlock: latestBlock,
      topics: [topic, transactionIdToBytes32(transactionId)]
    });

    if (logs.length === 0) {
      return null;
    }

    const latest = logs[logs.length - 1];
    const parsed = CONTRACT_INTERFACE.parseLog({
      topics: latest.topics,
      data: latest.data
    });

    if (!parsed) {
      throw blockchainVerificationError("unable to decode anchor event");
    }

    return {
      txHash: latest.transactionHash,
      blockNumber: latest.blockNumber,
      blockHash: latest.blockHash,
      transactionId: parsed.args[0],
      sender: getAddress(parsed.args[1]),
      receiver: getAddress(parsed.args[2]),
      amountWei: BigInt(parsed.args[3]).toString()
    };
  }

  async verifyConfirmedTransaction({
    txHash,
    confirmedBlockNumber,
    confirmedBlockHash
  }) {
    validateTransactionHash(txHash);

    const normalizedExpectedHash = String(confirmedBlockHash).toLowerCase();
    const canonicalBlock = await this.provider.getBlock(Number(confirmedBlockNumber));

    if (!canonicalBlock) {
      const error = new Error("canonical block could not be read for reorg validation");
      error.code = "BLOCKCHAIN_REORG_CHECK_UNAVAILABLE";
      error.statusCode = 503;
      throw error;
    }

    if (String(canonicalBlock.hash).toLowerCase() !== normalizedExpectedHash) {
      return { reorged: true, reason: "confirmed block no longer matches canonical evidence" };
    }

    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return {
        reorged: false,
        verified: false,
        reason: "receipt temporarily unavailable while canonical block remains unchanged"
      };
    }

    const normalizedReceiptHash = String(receipt.blockHash).toLowerCase();

    if (
      receipt.status !== 1 ||
      receipt.blockNumber !== Number(confirmedBlockNumber) ||
      normalizedReceiptHash !== normalizedExpectedHash
    ) {
      return {
        reorged: true,
        reason: "confirmed receipt no longer matches canonical evidence"
      };
    }

    return { reorged: false, verified: true };
  }

  async getTransactionReceipt(txHash) {
    validateTransactionHash(txHash);

    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return null;
    }

    return {
      txHash: receipt.hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash
    };
  }
}

export function transactionIdToBytes32(transactionId) {
  if (typeof transactionId !== "string" || transactionId.length === 0) {
    throw new Error("transactionId is required");
  }

  return id(transactionId);
}

export function validateTransactionHash(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("invalid transaction hash");
  }

  getBytes(hash);
  return hash;
}

function blockchainVerificationError(message) {
  const error = new Error(message);
  error.code = "BLOCKCHAIN_VERIFICATION_FAILED";
  error.statusCode = 409;
  return error;
}


export function createRpcProvider({ rpcUrl, rpcUrls, chainId }) {
  const urls = [rpcUrls, rpcUrl]
    .filter((value) => value !== undefined && value !== null)
    .flatMap((value) =>
      Array.isArray(value) ? value : String(value).split(",")
    )
    .map((value) => String(value).trim())
    .filter(Boolean);

  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0) {
    throw new Error("CHAIN_RPC_URL or CHAIN_RPC_URLS is required");
  }

  if (uniqueUrls.length === 1) {
    return new JsonRpcProvider(
      uniqueUrls[0],
      chainId ? Number(chainId) : undefined,
      {
        staticNetwork: chainId ? true : null
      }
    );
  }

  const providers = uniqueUrls.map((url, index) => ({
    provider: new JsonRpcProvider(
      url,
      chainId ? Number(chainId) : undefined,
      {
        staticNetwork: chainId ? true : null
      }
    ),
    priority: index + 1,
    weight: 1,
    stallTimeout: 1_000
  }));

  return new FallbackProvider(
    providers,
    chainId ? Number(chainId) : undefined,
    { quorum: 1 }
  );
}
