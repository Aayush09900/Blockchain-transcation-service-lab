import assert from "node:assert/strict";
import { network } from "hardhat";
import { EthersBlockchainAdapter } from "../../src/blockchain-adapter.js";

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
});
