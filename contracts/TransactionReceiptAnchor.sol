// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract TransactionReceiptAnchor {
    struct Anchor {
        address sender;
        address receiver;
        uint256 amount;
        uint64 blockNumber;
        uint64 timestamp;
    }

    mapping(bytes32 => Anchor) private anchors;

    event TransactionAnchored(
        bytes32 indexed transactionId,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        uint256 blockNumber,
        uint256 timestamp
    );

    address public immutable anchorer;

    error AlreadyAnchored(bytes32 transactionId);
    error InvalidAddress();
    error InvalidAmount();
    error Unauthorized();

    constructor() {
        anchorer = msg.sender;
    }

    modifier onlyAnchorer() {
        if (msg.sender != anchorer) {
            revert Unauthorized();
        }
        _;
    }

    function anchor(
        bytes32 transactionId,
        address sender,
        address receiver,
        uint256 amount
    ) external onlyAnchorer {
        if (anchors[transactionId].timestamp != 0) {
            revert AlreadyAnchored(transactionId);
        }

        if (sender == address(0) || receiver == address(0)) {
            revert InvalidAddress();
        }

        if (amount == 0) {
            revert InvalidAmount();
        }

        anchors[transactionId] = Anchor({
            sender: sender,
            receiver: receiver,
            amount: amount,
            blockNumber: uint64(block.number),
            timestamp: uint64(block.timestamp)
        });

        emit TransactionAnchored(
            transactionId,
            sender,
            receiver,
            amount,
            block.number,
            block.timestamp
        );
    }

    function getAnchor(bytes32 transactionId)
        external
        view
        returns (
            address sender,
            address receiver,
            uint256 amount,
            uint64 blockNumber,
            uint64 timestamp
        )
    {
        Anchor memory item = anchors[transactionId];

        return (
            item.sender,
            item.receiver,
            item.amount,
            item.blockNumber,
            item.timestamp
        );
    }
}
