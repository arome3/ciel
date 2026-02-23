// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IReceiver.sol";
import "./interfaces/Errors.sol";

/// @title WalletActivityConsumer
/// @notice Receives and stores wallet activity reports from CRE DON
/// @dev Implements IReceiver for Template 12 onchain report delivery
contract WalletActivityConsumer is IReceiver, Ownable2Step, ReentrancyGuard {
    struct TransferReport {
        address from;
        address to;
        uint256 value;
        uint256 timestamp;
        bytes32 reportHash;
    }

    event TransferReported(
        address indexed from,
        address indexed to,
        uint256 value,
        uint256 timestamp
    );

    event SenderAuthorized(address indexed sender);
    event SenderUnauthorized(address indexed sender);

    uint256 public constant MAX_HISTORY = 1000;

    TransferReport public latestReport;
    TransferReport[] public reportHistory;
    mapping(address => bool) private _authorizedSenders;
    uint256 private _nextIndex;
    bool private _historyWrapped;

    constructor() Ownable(msg.sender) {}

    modifier onlyAuthorized() {
        if (!_authorizedSenders[msg.sender]) revert NotAuthorizedSender();
        _;
    }

    /// @inheritdoc IReceiver
    function onReport(
        bytes calldata, /* metadata */
        bytes calldata report
    ) external onlyAuthorized nonReentrant {
        (address from, address to, uint256 value, uint256 timestamp) =
            abi.decode(report, (address, address, uint256, uint256));

        TransferReport memory tr = TransferReport({
            from: from,
            to: to,
            value: value,
            timestamp: timestamp,
            reportHash: keccak256(report)
        });

        latestReport = tr;

        if (reportHistory.length < MAX_HISTORY) {
            reportHistory.push(tr);
        } else {
            reportHistory[_nextIndex] = tr;
            _nextIndex = (_nextIndex + 1) % MAX_HISTORY;
            _historyWrapped = true;
        }

        emit TransferReported(from, to, value, timestamp);
    }

    function getLatestReport() external view returns (TransferReport memory) {
        return latestReport;
    }

    function getReportCount() external view returns (uint256) {
        return _historyWrapped ? MAX_HISTORY : reportHistory.length;
    }

    function getReport(uint256 index) external view returns (TransferReport memory) {
        return reportHistory[index];
    }

    function isHistoryWrapped() external view returns (bool) {
        return _historyWrapped;
    }

    function addAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = true;
        emit SenderAuthorized(sender);
    }

    function removeAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = false;
        emit SenderUnauthorized(sender);
    }

    function isAuthorizedSender(address sender) external view returns (bool) {
        return _authorizedSenders[sender];
    }
}
