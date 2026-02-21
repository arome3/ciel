// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IReceiver.sol";
import "./interfaces/Errors.sol";

/// @title ConsensusConsumer
/// @notice Receives and stores Multi-AI Consensus Oracle results onchain
/// @dev Implements IReceiver for CRE DON report delivery with single-result storage
contract ConsensusConsumer is IReceiver, Ownable2Step, ReentrancyGuard {
    // --- Types ---

    struct OracleResult {
        string answer;
        uint256 confidence;     // Scaled by 1000 (e.g., 1000 = 100%)
        uint256 modelsAgreed;
        uint256 timestamp;
        bytes32 reportHash;
    }

    // --- Events ---

    event ResultReceived(
        string answer,
        uint256 confidence,
        uint256 modelsAgreed,
        uint256 timestamp
    );

    event SenderAuthorized(address indexed sender);
    event SenderUnauthorized(address indexed sender);

    // --- Storage ---

    /// @notice Latest oracle result
    OracleResult public latestResult;

    /// @notice Addresses authorized to call onReport
    mapping(address => bool) private _authorizedSenders;

    // --- Constructor ---

    constructor() Ownable(msg.sender) {}

    // --- Modifiers ---

    modifier onlyAuthorized() {
        if (!_authorizedSenders[msg.sender]) revert NotAuthorizedSender();
        _;
    }

    // --- IReceiver Implementation ---

    /// @inheritdoc IReceiver
    function onReport(
        bytes calldata, /* metadata — accepted for interface compliance */
        bytes calldata report
    ) external onlyAuthorized nonReentrant {
        // Decode report — matches doc body's data shape: (answer, confidence, modelsAgreed)
        (string memory answer, uint256 confidence, uint256 modelsAgreed) =
            abi.decode(report, (string, uint256, uint256));

        latestResult = OracleResult({
            answer: answer,
            confidence: confidence,
            modelsAgreed: modelsAgreed,
            timestamp: block.timestamp,
            reportHash: keccak256(report)
        });

        emit ResultReceived(answer, confidence, modelsAgreed, block.timestamp);
    }

    // --- Read Functions ---

    /// @notice Get the latest oracle result
    function getLatestResult() external view returns (OracleResult memory) {
        return latestResult;
    }

    // --- Owner Functions ---

    /// @notice Add an authorized sender
    function addAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = true;
        emit SenderAuthorized(sender);
    }

    /// @notice Remove an authorized sender
    function removeAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = false;
        emit SenderUnauthorized(sender);
    }

    /// @notice Check if an address is authorized
    function isAuthorizedSender(address sender) external view returns (bool) {
        return _authorizedSenders[sender];
    }
}
