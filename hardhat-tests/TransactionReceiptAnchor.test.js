import assert from "node:assert/strict";
import { network } from "hardhat";
import { EthersBlockchainAdapter, EthersReceiptMonitor } from "../src/blockchain-adapter.js";

const { ethers } = await network.create();

describe("TransactionReceiptAnchor", function () {
  it("anchors a transaction and reads it back through ethers.js", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    await adapter.healthCheck(31337);

    const result = await adapter.anchorTransaction({
      transactionId: "transaction-001",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "1000000000000000"
    });

    assert.match(result.txHash, /^0x[0-9a-f]{64}$/i);
    assert.equal(result.blockNumber > 0, true);
    assert.equal(result.chainId, "31337");

    const anchor = await adapter.getAnchor("transaction-001");

    assert.equal(anchor.sender, sender.address);
    assert.equal(anchor.receiver, receiver.address);
    assert.equal(anchor.amountWei, "1000000000000000");
    assert.equal(anchor.blockNumber, result.blockNumber);
  });


  it("broadcasts an anchor without waiting for the receipt", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    const broadcast = await adapter.broadcastAnchorTransaction({
      transactionId: "broadcast-only",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "2"
    });

    assert.match(broadcast.txHash, /^0x[0-9a-f]{64}$/i);
    assert.equal(broadcast.chainId, "31337");

    const receipt = await adapter.getTransactionReceipt(broadcast.txHash);
    assert.equal(receipt.status, 1);
    assert.equal(receipt.txHash, broadcast.txHash);
  });


  it("reconciles a mined transaction with the read-only receipt monitor", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    const broadcast = await adapter.broadcastAnchorTransaction({
      transactionId: "monitor-test",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "3"
    });

    const monitor = new EthersReceiptMonitor({
      provider: ethers.provider
    });

    const receipt = await monitor.getTransactionReceipt(broadcast.txHash);

    assert.equal(receipt.status, 1);
    assert.equal(receipt.txHash, broadcast.txHash);
  });



  it("recovers a broadcast transaction by indexed anchor event", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const monitor = new EthersReceiptMonitor({
      provider: ethers.provider
    });

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    const transactionId = "recovery-test";
    const broadcast = await adapter.broadcastAnchorTransaction({
      transactionId,
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "7"
    });

    await ethers.provider.waitForTransaction(broadcast.txHash);

    const recovered = await monitor.findAnchorTransaction({
      transactionId,
      contractAddress: await contract.getAddress(),
      lookbackBlocks: 100
    });

    assert.equal(recovered.txHash, broadcast.txHash);
    assert.equal(recovered.amountWei, "7");
  });

  it("rejects a valid receipt when the on-chain anchor payload does not match the transaction record", async function () {
    const [sender, receiver, attacker] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    const broadcast = await adapter.broadcastAnchorTransaction({
      transactionId: "verification-mismatch",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "5"
    });

    const verified = await adapter.verifySubmittedTransaction({
      transactionId: "verification-mismatch",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "5",
      txHash: broadcast.txHash
    });

    assert.equal(verified.confirmed, true);

    await assert.rejects(
      adapter.verifySubmittedTransaction({
        transactionId: "verification-mismatch",
        sender: attacker.address,
        receiver: receiver.address,
        amountWei: "5",
        txHash: broadcast.txHash
      }),
      /anchor payload does not match transaction/
    );
  });

  it("rejects duplicate transaction IDs on-chain", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress()
    });

    await adapter.anchorTransaction({
      transactionId: "duplicate-transaction",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "1"
    });

    await assert.rejects(
      adapter.anchorTransaction({
        transactionId: "duplicate-transaction",
        sender: sender.address,
        receiver: receiver.address,
        amountWei: "1"
      })
    );
  });

  it("only allows the configured anchorer to write records", async function () {
    const [anchorer, attacker, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const attackerContract = contract.connect(attacker);

    await assert.rejects(
      attackerContract.anchor(
        ethers.id("unauthorized"),
        attacker.address,
        receiver.address,
        1n
      )
    );

    assert.equal(await contract.anchorer(), anchorer.address);
  });
  it("waits for the configured confirmation depth before confirming", async function () {
    const [sender, receiver] = await ethers.getSigners();

    const contract = await ethers.deployContract("TransactionReceiptAnchor");
    await contract.waitForDeployment();

    const adapter = new EthersBlockchainAdapter({
      provider: ethers.provider,
      signer: sender,
      contractAddress: await contract.getAddress(),
      confirmationDepth: 2
    });

    const broadcast = await adapter.broadcastAnchorTransaction({
      transactionId: "confirmation-depth-test",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "9"
    });

    const pending = await adapter.verifySubmittedTransaction({
      transactionId: "confirmation-depth-test",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "9",
      txHash: broadcast.txHash
    });

    assert.equal(pending.confirmed, false);
    assert.equal(pending.confirmations, 1);
    assert.equal(pending.requiredConfirmations, 2);

    await ethers.provider.send("evm_mine");

    const confirmed = await adapter.verifySubmittedTransaction({
      transactionId: "confirmation-depth-test",
      sender: sender.address,
      receiver: receiver.address,
      amountWei: "9",
      txHash: broadcast.txHash
    });

    assert.equal(confirmed.confirmed, true);
  });
});
