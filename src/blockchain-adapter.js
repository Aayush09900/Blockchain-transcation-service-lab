import {
  Contract,
  Interface,
  JsonRpcProvider,
  Transaction,
  Wallet,
  getAddress,
  getBytes,
  id,
  isAddress
} from "ethers";

const ABI = [
  "function anchor(bytes32 transactionId, address sender, address receiver, uint256 amount)",
  "function getAnchor(bytes32 transactionId) view returns (address sender, address receiver, uint256 amount, uint64 blockNumber, uint64 timestamp)",
  "event TransactionAnchored(bytes32 indexed transactionId, address indexed sender, address indexed receiver, uint256 amount, uint256 blockNumber, uint256 timestamp)"
];

const CONTRACT_INTERFACE = new Interface(ABI);

export class EthersBlockchainAdapter {
  constructor({ provider, signer, contractAddress }) {
    if (!provider) {
      throw new Error("ethers provider is required");
    }

    if (!signer) {
      throw new Error("ethers signer is required");
    }

    if (!isAddress(contractAddress)) {
      throw new Error("valid anchor contract address is required");
    }

    this.provider = provider;
    this.signer = signer;
    this.contractAddress = getAddress(contractAddress);
    this.contract = new Contract(this.contractAddress, ABI, signer);
  }

  static fromConfig({
    rpcUrl = process.env.CHAIN_RPC_URL,
    privateKey = process.env.CHAIN_SIGNER_PRIVATE_KEY,
    contractAddress = process.env.ANCHOR_CONTRACT_ADDRESS,
    chainId
  } = {}) {
    if (!rpcUrl || !privateKey || !contractAddress) {
      throw new Error(
        "CHAIN_RPC_URL, CHAIN_SIGNER_PRIVATE_KEY and ANCHOR_CONTRACT_ADDRESS are required"
      );
    }

    const provider = new JsonRpcProvider(
      rpcUrl,
      chainId ? Number(chainId) : undefined,
      {
        staticNetwork: chainId ? Number(chainId) : null
      }
    );

    const signer = new Wallet(privateKey, provider);

    return new EthersBlockchainAdapter({
      provider,
      signer,
      contractAddress
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
      BigInt(amountWei)
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
  constructor({ provider }) {
    if (!provider) {
      throw new Error("ethers provider is required");
    }

    this.provider = provider;
  }

  static fromConfig({
    rpcUrl = process.env.CHAIN_RPC_URL,
    chainId
  } = {}) {
    if (!rpcUrl) {
      throw new Error("CHAIN_RPC_URL is required");
    }

    const provider = new JsonRpcProvider(
      rpcUrl,
      chainId ? Number(chainId) : undefined,
      {
        staticNetwork: chainId ? Number(chainId) : null
      }
    );

    return new EthersReceiptMonitor({ provider });
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
