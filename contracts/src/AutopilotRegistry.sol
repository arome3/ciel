// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAutopilotRegistry.sol";
import "./interfaces/Errors.sol";

/// @title AutopilotRegistry
/// @notice Onchain registry for Ciel CRE workflow metadata and discovery
/// @dev Stores workflow metadata, supports category/chain indexing, tracks executions
contract AutopilotRegistry is IAutopilotRegistry, Ownable2Step, ReentrancyGuard {
    // --- Storage ---

    /// @notice Monotonic nonce for collision-free workflow IDs
    uint256 private _nonce;

    /// @notice All workflow IDs
    bytes32[] private _allWorkflows;

    /// @notice Workflow ID -> metadata
    mapping(bytes32 => WorkflowMetadata) private _workflows;

    /// @notice Category -> workflow IDs (index for search)
    mapping(string => bytes32[]) private _categoryIndex;

    /// @notice Chain selector -> workflow IDs (index for search)
    mapping(uint64 => bytes32[]) private _chainIndex;

    /// @notice Creator -> workflow IDs
    mapping(address => bytes32[]) private _creatorWorkflows;

    /// @notice Workflow ID -> exists flag (for existence checks)
    mapping(bytes32 => bool) private _exists;

    /// @notice Addresses authorized to call recordExecution
    mapping(address => bool) private _authorizedSenders;

    // --- Constructor ---

    constructor() Ownable(msg.sender) {}

    // --- Modifiers ---

    modifier workflowExists(bytes32 workflowId) {
        if (!_exists[workflowId]) revert WorkflowNotFound();
        _;
    }

    modifier onlyCreator(bytes32 workflowId) {
        if (_workflows[workflowId].creator != msg.sender) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (!_authorizedSenders[msg.sender]) revert NotAuthorizedSender();
        _;
    }

    // --- Publish ---

    /// @inheritdoc IAutopilotRegistry
    function publishWorkflow(
        string calldata name,
        string calldata description,
        string calldata category,
        uint64[] calldata supportedChains,
        string[] calldata capabilities,
        string calldata x402Endpoint,
        uint256 pricePerExecution
    ) external nonReentrant returns (bytes32 workflowId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(category).length == 0) revert EmptyCategory();
        if (supportedChains.length == 0) revert NoChainsProvided();

        // Generate collision-free workflow ID using monotonic nonce
        workflowId = keccak256(abi.encodePacked(msg.sender, name, _nonce++));
        if (_exists[workflowId]) revert WorkflowIdCollision();

        // Store metadata
        WorkflowMetadata storage meta = _workflows[workflowId];
        meta.creator = msg.sender;
        meta.name = name;
        meta.description = description;
        meta.category = category;
        meta.supportedChains = supportedChains;
        meta.capabilities = capabilities;
        meta.x402Endpoint = x402Endpoint;
        meta.pricePerExecution = pricePerExecution;
        meta.createdAt = block.timestamp;
        meta.active = true;

        // Update indexes
        _exists[workflowId] = true;
        _allWorkflows.push(workflowId);
        _creatorWorkflows[msg.sender].push(workflowId);
        _categoryIndex[category].push(workflowId);

        for (uint256 i = 0; i < supportedChains.length;) {
            _chainIndex[supportedChains[i]].push(workflowId);
            unchecked { ++i; }
        }

        emit WorkflowPublished(workflowId, msg.sender, name, category);

        return workflowId;
    }

    // --- Update ---

    /// @inheritdoc IAutopilotRegistry
    function updateWorkflow(
        bytes32 workflowId,
        string calldata name,
        string calldata description,
        string calldata category,
        string[] calldata capabilities,
        string calldata x402Endpoint,
        uint256 pricePerExecution
    ) external workflowExists(workflowId) onlyCreator(workflowId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(category).length == 0) revert EmptyCategory();

        WorkflowMetadata storage meta = _workflows[workflowId];
        if (!meta.active) revert WorkflowNotActive();

        // If category changed, append to new index (old entry is stale but harmless)
        if (keccak256(bytes(meta.category)) != keccak256(bytes(category))) {
            _categoryIndex[category].push(workflowId);
        }

        meta.name = name;
        meta.description = description;
        meta.category = category;
        meta.capabilities = capabilities;
        meta.x402Endpoint = x402Endpoint;
        meta.pricePerExecution = pricePerExecution;

        emit WorkflowUpdated(workflowId, msg.sender);
    }

    // --- Read ---

    /// @inheritdoc IAutopilotRegistry
    function getWorkflow(
        bytes32 workflowId
    ) external view workflowExists(workflowId) returns (WorkflowMetadata memory) {
        return _workflows[workflowId];
    }

    /// @inheritdoc IAutopilotRegistry
    function searchByCategory(
        string calldata category,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total) {
        return _paginate(_categoryIndex[category], offset, limit);
    }

    /// @inheritdoc IAutopilotRegistry
    function searchByChain(
        uint64 chainSelector,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total) {
        return _paginate(_chainIndex[chainSelector], offset, limit);
    }

    /// @inheritdoc IAutopilotRegistry
    function getAllWorkflows(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total) {
        return _paginate(_allWorkflows, offset, limit);
    }

    /// @inheritdoc IAutopilotRegistry
    function getCreatorWorkflows(
        address creator,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total) {
        return _paginate(_creatorWorkflows[creator], offset, limit);
    }

    // --- Execution Tracking ---

    /// @inheritdoc IAutopilotRegistry
    function recordExecution(
        bytes32 workflowId,
        bool success
    ) external workflowExists(workflowId) onlyAuthorized {
        WorkflowMetadata storage meta = _workflows[workflowId];
        meta.totalExecutions++;
        if (success) {
            meta.successfulExecutions++;
        }

        emit WorkflowExecuted(workflowId, success);
    }

    // --- Deactivate / Reactivate ---

    /// @inheritdoc IAutopilotRegistry
    function deactivateWorkflow(
        bytes32 workflowId
    ) external workflowExists(workflowId) onlyCreator(workflowId) {
        if (!_workflows[workflowId].active) revert WorkflowNotActive();
        _workflows[workflowId].active = false;
        emit WorkflowDeactivated(workflowId, msg.sender);
    }

    /// @inheritdoc IAutopilotRegistry
    function reactivateWorkflow(
        bytes32 workflowId
    ) external workflowExists(workflowId) onlyCreator(workflowId) {
        if (_workflows[workflowId].active) revert WorkflowAlreadyActive();
        _workflows[workflowId].active = true;
        emit WorkflowReactivated(workflowId, msg.sender);
    }

    // --- Access Control ---

    /// @inheritdoc IAutopilotRegistry
    function addAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = true;
        emit AuthorizedSenderAdded(sender);
    }

    /// @inheritdoc IAutopilotRegistry
    function removeAuthorizedSender(address sender) external onlyOwner {
        _authorizedSenders[sender] = false;
        emit AuthorizedSenderRemoved(sender);
    }

    /// @inheritdoc IAutopilotRegistry
    function isAuthorizedSender(address sender) external view returns (bool) {
        return _authorizedSenders[sender];
    }

    // --- Internal ---

    /// @notice Paginate a storage array
    /// @param arr The storage array to paginate
    /// @param offset Start index
    /// @param limit Max items to return (0 = empty result)
    /// @return ids The paginated slice
    /// @return total Total length of the source array
    function _paginate(
        bytes32[] storage arr,
        uint256 offset,
        uint256 limit
    ) internal view returns (bytes32[] memory ids, uint256 total) {
        total = arr.length;

        if (offset >= total || limit == 0) {
            return (new bytes32[](0), total);
        }

        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;

        ids = new bytes32[](count);
        for (uint256 i = 0; i < count;) {
            ids[i] = arr[offset + i];
            unchecked { ++i; }
        }
    }
}
