// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAutopilotRegistry
/// @notice Interface for the Ciel workflow registry
interface IAutopilotRegistry {
    struct WorkflowMetadata {
        address creator;
        string name;
        string description;
        string category;
        uint64[] supportedChains;
        string[] capabilities;
        string x402Endpoint;
        uint256 pricePerExecution;
        uint256 totalExecutions;
        uint256 successfulExecutions;
        uint256 createdAt;
        bool active;
    }

    // --- Events ---

    event WorkflowPublished(
        bytes32 indexed workflowId,
        address indexed creator,
        string name,
        string category
    );

    event WorkflowUpdated(
        bytes32 indexed workflowId,
        address indexed creator
    );

    event WorkflowExecuted(
        bytes32 indexed workflowId,
        bool success
    );

    event WorkflowDeactivated(
        bytes32 indexed workflowId,
        address indexed creator
    );

    event WorkflowReactivated(
        bytes32 indexed workflowId,
        address indexed creator
    );

    event AuthorizedSenderAdded(address indexed sender);
    event AuthorizedSenderRemoved(address indexed sender);

    // --- Write Functions ---

    function publishWorkflow(
        string calldata name,
        string calldata description,
        string calldata category,
        uint64[] calldata supportedChains,
        string[] calldata capabilities,
        string calldata x402Endpoint,
        uint256 pricePerExecution
    ) external returns (bytes32 workflowId);

    function updateWorkflow(
        bytes32 workflowId,
        string calldata name,
        string calldata description,
        string calldata category,
        string[] calldata capabilities,
        string calldata x402Endpoint,
        uint256 pricePerExecution
    ) external;

    function recordExecution(bytes32 workflowId, bool success) external;
    function deactivateWorkflow(bytes32 workflowId) external;
    function reactivateWorkflow(bytes32 workflowId) external;

    function addAuthorizedSender(address sender) external;
    function removeAuthorizedSender(address sender) external;

    // --- Read Functions ---

    function getWorkflow(bytes32 workflowId) external view returns (WorkflowMetadata memory);
    function isAuthorizedSender(address sender) external view returns (bool);

    function searchByCategory(
        string calldata category,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total);

    function searchByChain(
        uint64 chainSelector,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total);

    function getAllWorkflows(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total);

    function getCreatorWorkflows(
        address creator,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids, uint256 total);
}
