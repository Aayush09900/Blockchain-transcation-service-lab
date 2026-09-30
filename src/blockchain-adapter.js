import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  id,
  isAddress
} from "ethers";

const ABI = [
  "function anchor(bytes32 transactionId, address sender, address receiver, uint256 amount)",
  "function getAnchor(bytes32 transactionId) view returns (address sender, address receiver, uint256 amount, uint64 blockNumber, uint64 timestamp)",
  "event TransactionAnchored(bytes32 indexed transactionId, address indexed sender, address indexed receiver, uint256 amount, uint256 blockNumber, uint256 timestamp)"
];

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
    this.contract = new Contract(contractAddress, ABI, signer);
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

  async anchorTransaction({
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

    const receipt = await transaction.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("blockchain transaction failed");
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionId: transactionId,
      chainId: (await this.provider.getNetwork()).chainId.toString()
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
