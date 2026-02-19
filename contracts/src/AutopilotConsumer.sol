// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IReceiver.sol";
import "./interfaces/IAutopilotRegistry.sol";
import "./interfaces/Errors.sol";

/// @title AutopilotConsumer
/// @notice Receives and stores CRE workflow reports onchain
/// @dev Implements IReceiver for CRE DON report delivery with circular buffer storage
contract AutopilotConsumer is IReceiver, Ownable2Step, ReentrancyGuard {
    // --- Constants ---

    /// @notice Maximum reports stored per workflow (circular buffer)
    uint256 public constant MAX_REPORT_HISTORY = 1000;

    // --- Events ---

    event ReportReceived(
        bytes32 indexed workflowId,
        address indexed sender,
        uint256 timestamp,
        uint256 reportLength
    );

    event RegistryUpdated(address indexed newRegistry);

    // --- Storage ---

    /// @notice Registry contract for bridge calls
    IAutopilotRegistry public registry;

    /// @notice Latest report per workflow ID
    mapping(bytes32 => bytes) public latestReports;

    /// @notice Circular buffer of reports per workflow ID
    mapping(bytes32 => bytes[]) private _reportHistory;

    /// @notice Timestamp of latest report per workflow ID
    mapping(bytes32 => uint256) public reportTimestamps;

    /// @notice Total report count per workflow ID (monotonic, not capped)
    mapping(bytes32 => uint256) public reportCounts;

    /// @notice Circular buffer write pointer per workflow ID
    mapping(bytes32 => uint256) private _writeIndex;

    /// @notice Whether the circular buffer has wrapped
    mapping(bytes32 => bool) private _historyWrapped;

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
        bytes calldata metadata,
        bytes calldata report
    ) external onlyAuthorized nonReentrant {
        // Extract workflow ID from metadata (first 32 bytes)
        bytes32 workflowId;
        if (metadata.length >= 32) {
            workflowId = bytes32(metadata[:32]);
        } else {
            // Use hash of metadata as fallback ID
            workflowId = keccak256(metadata);
        }

        // Store latest report
        latestReports[workflowId] = report;
        reportTimestamps[workflowId] = block.timestamp;
        reportCounts[workflowId]++;

        // Circular buffer: push until full, then overwrite
        if (_reportHistory[workflowId].length < MAX_REPORT_HISTORY) {
            _reportHistory[workflowId].push(report);
        } else {
            uint256 idx = _writeIndex[workflowId] % MAX_REPORT_HISTORY;
            _reportHistory[workflowId][idx] = report;
            _writeIndex[workflowId] = idx + 1;
            _historyWrapped[workflowId] = true;
        }

        // Non-blocking registry bridge
        if (address(registry) != address(0)) {
            try registry.recordExecution(workflowId, true) {} catch {}
        }

        emit ReportReceived(
            workflowId,
            msg.sender,
            block.timestamp,
            report.length
        );
    }

    // --- Read Functions ---

    /// @notice Get the latest report for a workflow
    function getLatestReport(
        bytes32 workflowId
    ) external view returns (bytes memory report, uint256 timestamp) {
        return (latestReports[workflowId], reportTimestamps[workflowId]);
    }

    /// @notice Get the total number of reports for a workflow
    function getReportCount(
        bytes32 workflowId
    ) external view returns (uint256) {
        return reportCounts[workflowId];
    }

    /// @notice Get a specific report by index from the circular buffer
    function getReport(
        bytes32 workflowId,
        uint256 index
    ) external view returns (bytes memory) {
        if (index >= _reportHistory[workflowId].length) {
            revert ReportIndexOutOfBounds();
        }
        return _reportHistory[workflowId][index];
    }

    /// @notice Get paginated reports for a workflow
    /// @param workflowId The workflow to query
    /// @param offset Start index in the stored buffer
    /// @param limit Max items to return
    /// @return reports The paginated slice
    /// @return total Total stored reports (capped at MAX_REPORT_HISTORY)
    function getAllReports(
        bytes32 workflowId,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes[] memory reports, uint256 total) {
        total = _reportHistory[workflowId].length;

        if (offset >= total || limit == 0) {
            return (new bytes[](0), total);
        }

        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;

        reports = new bytes[](count);
        for (uint256 i = 0; i < count;) {
            reports[i] = _reportHistory[workflowId][offset + i];
            unchecked { ++i; }
        }
    }

    // --- Owner Functions ---

    /// @notice Set or disable the registry bridge
    /// @param _registry Address of the registry (address(0) to disable)
    function setRegistry(address _registry) external onlyOwner {
        registry = IAutopilotRegistry(_registry);
        emit RegistryUpdated(_registry);
    }

    /// @notice Add an authorized sender
    function addAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = true;
    }

    /// @notice Remove an authorized sender
    function removeAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = false;
    }

    /// @notice Check if an address is authorized
    function isAuthorizedSender(address sender) external view returns (bool) {
        return _authorizedSenders[sender];
    }
}
