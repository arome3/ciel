// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AutopilotRegistry.sol";
import "../src/interfaces/IAutopilotRegistry.sol";
import "../src/interfaces/Errors.sol";

contract AutopilotRegistryTest is Test {
    AutopilotRegistry public registry;

    address public deployer;
    address public creator = address(0x1);
    address public other = address(0x2);
    address public authorizedCaller = address(0x3);

    function setUp() public {
        deployer = address(this);
        registry = new AutopilotRegistry();

        // Authorize a sender for recordExecution tests
        registry.addAuthorizedSender(authorizedCaller);
    }

    // --- Helpers ---

    function _publishTestWorkflow() internal returns (bytes32) {
        return _publishTestWorkflowAs(creator);
    }

    function _publishTestWorkflowAs(address _creator) internal returns (bytes32) {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080; // Base Sepolia

        string[] memory caps = new string[](2);
        caps[0] = "HTTPClient";
        caps[1] = "EVMClient";

        vm.prank(_creator);
        bytes32 workflowId = registry.publishWorkflow(
            "Price Monitor",
            "Monitors ETH price and writes onchain",
            "defi",
            chains,
            caps,
            "https://ciel.example.com/api/workflows/price-monitor/execute",
            100000 // 0.10 USDC (6 decimals)
        );

        return workflowId;
    }

    // ========================================
    // Publish Tests
    // ========================================

    function test_publishWorkflow() public {
        bytes32 workflowId = _publishTestWorkflow();

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.creator, creator);
        assertEq(meta.name, "Price Monitor");
        assertEq(meta.description, "Monitors ETH price and writes onchain");
        assertEq(meta.category, "defi");
        assertEq(meta.supportedChains.length, 1);
        assertEq(meta.supportedChains[0], 10344971235874465080);
        assertEq(meta.capabilities.length, 2);
        assertEq(meta.pricePerExecution, 100000);
        assertEq(meta.totalExecutions, 0);
        assertEq(meta.successfulExecutions, 0);
        assertTrue(meta.active);
    }

    function test_publishWorkflow_emitsEvent() public {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectEmit(false, true, false, true);
        emit IAutopilotRegistry.WorkflowPublished(
            bytes32(0), // workflowId is not checked (indexed)
            creator,
            "Test",
            "defi"
        );
        registry.publishWorkflow("Test", "Desc", "defi", chains, caps, "https://x.com", 0);
    }

    function test_publishWorkflow_revert_emptyName() public {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(EmptyName.selector);
        registry.publishWorkflow("", "Desc", "defi", chains, caps, "https://x.com", 0);
    }

    function test_publishWorkflow_revert_emptyCategory() public {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(EmptyCategory.selector);
        registry.publishWorkflow("Test", "Desc", "", chains, caps, "https://x.com", 0);
    }

    function test_publishWorkflow_revert_noChains() public {
        uint64[] memory chains = new uint64[](0);
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(NoChainsProvided.selector);
        registry.publishWorkflow("Test", "Desc", "defi", chains, caps, "https://x.com", 0);
    }

    function test_publishWorkflow_sameNameSameBlock_noCollision() public {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        bytes32 id1 = registry.publishWorkflow("SameName", "Desc1", "defi", chains, caps, "", 0);

        vm.prank(creator);
        bytes32 id2 = registry.publishWorkflow("SameName", "Desc2", "defi", chains, caps, "", 0);

        assertTrue(id1 != id2, "Nonce-based IDs should not collide");
    }

    // ========================================
    // Search Tests (paginated)
    // ========================================

    function test_searchByCategory_paginated() public {
        bytes32 workflowId = _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.searchByCategory("defi", 0, 10);
        assertEq(total, 1);
        assertEq(results.length, 1);
        assertEq(results[0], workflowId);
    }

    function test_searchByChain_paginated() public {
        bytes32 workflowId = _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.searchByChain(10344971235874465080, 0, 10);
        assertEq(total, 1);
        assertEq(results.length, 1);
        assertEq(results[0], workflowId);
    }

    function test_getAllWorkflows_paginated() public {
        bytes32 workflowId = _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.getAllWorkflows(0, 10);
        assertEq(total, 1);
        assertEq(results.length, 1);
        assertEq(results[0], workflowId);
    }

    function test_getCreatorWorkflows_paginated() public {
        bytes32 workflowId = _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.getCreatorWorkflows(creator, 0, 10);
        assertEq(total, 1);
        assertEq(results.length, 1);
        assertEq(results[0], workflowId);
    }

    function test_pagination_offsetBeyondTotal() public {
        _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.getAllWorkflows(100, 10);
        assertEq(total, 1);
        assertEq(results.length, 0);
    }

    function test_pagination_limitZero() public {
        _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.getAllWorkflows(0, 0);
        assertEq(total, 1);
        assertEq(results.length, 0);
    }

    function test_pagination_limitExceedsRemaining() public {
        _publishTestWorkflow();

        (bytes32[] memory results, uint256 total) = registry.getAllWorkflows(0, 100);
        assertEq(total, 1);
        assertEq(results.length, 1);
    }

    function test_pagination_multipleItems() public {
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        // Publish 5 workflows
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(creator);
            registry.publishWorkflow(
                string(abi.encodePacked("Workflow", vm.toString(i))),
                "Desc",
                "defi",
                chains,
                caps,
                "",
                0
            );
        }

        // Get page 1 (items 0-1)
        (bytes32[] memory page1, uint256 total1) = registry.getAllWorkflows(0, 2);
        assertEq(total1, 5);
        assertEq(page1.length, 2);

        // Get page 2 (items 2-3)
        (bytes32[] memory page2, uint256 total2) = registry.getAllWorkflows(2, 2);
        assertEq(total2, 5);
        assertEq(page2.length, 2);

        // Get page 3 (item 4)
        (bytes32[] memory page3, uint256 total3) = registry.getAllWorkflows(4, 2);
        assertEq(total3, 5);
        assertEq(page3.length, 1);

        // Ensure no overlap
        assertTrue(page1[0] != page2[0]);
        assertTrue(page2[0] != page3[0]);
    }

    // ========================================
    // Execution Tracking Tests
    // ========================================

    function test_recordExecution_success() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(authorizedCaller);
        registry.recordExecution(workflowId, true);

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.totalExecutions, 1);
        assertEq(meta.successfulExecutions, 1);
    }

    function test_recordExecution_failure() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(authorizedCaller);
        registry.recordExecution(workflowId, false);

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.totalExecutions, 1);
        assertEq(meta.successfulExecutions, 0);
    }

    function test_recordExecution_multiple() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(authorizedCaller);
        registry.recordExecution(workflowId, true);
        vm.prank(authorizedCaller);
        registry.recordExecution(workflowId, true);
        vm.prank(authorizedCaller);
        registry.recordExecution(workflowId, false);

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.totalExecutions, 3);
        assertEq(meta.successfulExecutions, 2);
    }

    function test_recordExecution_revert_unauthorized() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(other);
        vm.expectRevert(NotAuthorizedSender.selector);
        registry.recordExecution(workflowId, true);
    }

    function test_recordExecution_revert_nonexistent() public {
        vm.prank(authorizedCaller);
        vm.expectRevert(WorkflowNotFound.selector);
        registry.recordExecution(bytes32(uint256(999)), true);
    }

    // ========================================
    // Deactivate Tests
    // ========================================

    function test_deactivateWorkflow() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertFalse(meta.active);
    }

    function test_deactivateWorkflow_emitsEvent() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        vm.expectEmit(true, true, false, false);
        emit IAutopilotRegistry.WorkflowDeactivated(workflowId, creator);
        registry.deactivateWorkflow(workflowId);
    }

    function test_deactivateWorkflow_revert_notCreator() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(other);
        vm.expectRevert(Unauthorized.selector);
        registry.deactivateWorkflow(workflowId);
    }

    function test_deactivateWorkflow_revert_nonexistent() public {
        vm.expectRevert(WorkflowNotFound.selector);
        registry.deactivateWorkflow(bytes32(uint256(999)));
    }

    function test_deactivateWorkflow_revert_alreadyInactive() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);

        vm.prank(creator);
        vm.expectRevert(WorkflowNotActive.selector);
        registry.deactivateWorkflow(workflowId);
    }

    // ========================================
    // Reactivate Tests
    // ========================================

    function test_reactivateWorkflow() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);
        assertFalse(registry.getWorkflow(workflowId).active);

        vm.prank(creator);
        registry.reactivateWorkflow(workflowId);
        assertTrue(registry.getWorkflow(workflowId).active);
    }

    function test_reactivateWorkflow_emitsEvent() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);

        vm.prank(creator);
        vm.expectEmit(true, true, false, false);
        emit IAutopilotRegistry.WorkflowReactivated(workflowId, creator);
        registry.reactivateWorkflow(workflowId);
    }

    function test_reactivateWorkflow_revert_notCreator() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);

        vm.prank(other);
        vm.expectRevert(Unauthorized.selector);
        registry.reactivateWorkflow(workflowId);
    }

    function test_reactivateWorkflow_revert_alreadyActive() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        vm.expectRevert(WorkflowAlreadyActive.selector);
        registry.reactivateWorkflow(workflowId);
    }

    function test_reactivateWorkflow_revert_nonexistent() public {
        vm.prank(creator);
        vm.expectRevert(WorkflowNotFound.selector);
        registry.reactivateWorkflow(bytes32(uint256(999)));
    }

    // ========================================
    // Update Workflow Tests
    // ========================================

    function test_updateWorkflow() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory newCaps = new string[](1);
        newCaps[0] = "NewCap";

        vm.prank(creator);
        registry.updateWorkflow(
            workflowId,
            "Updated Name",
            "Updated Desc",
            "defi",
            newCaps,
            "https://new-endpoint.com",
            200000
        );

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.name, "Updated Name");
        assertEq(meta.description, "Updated Desc");
        assertEq(meta.capabilities.length, 1);
        assertEq(meta.capabilities[0], "NewCap");
        assertEq(meta.x402Endpoint, "https://new-endpoint.com");
        assertEq(meta.pricePerExecution, 200000);
    }

    function test_updateWorkflow_categoryChange() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        registry.updateWorkflow(
            workflowId,
            "Price Monitor",
            "Desc",
            "analytics",
            caps,
            "",
            0
        );

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.category, "analytics");

        // New category index should contain the workflow
        (bytes32[] memory results,) = registry.searchByCategory("analytics", 0, 10);
        assertEq(results.length, 1);
        assertEq(results[0], workflowId);
    }

    function test_updateWorkflow_emitsEvent() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectEmit(true, true, false, false);
        emit IAutopilotRegistry.WorkflowUpdated(workflowId, creator);
        registry.updateWorkflow(workflowId, "Name", "Desc", "defi", caps, "", 0);
    }

    function test_updateWorkflow_revert_notCreator() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(other);
        vm.expectRevert(Unauthorized.selector);
        registry.updateWorkflow(workflowId, "Name", "Desc", "defi", caps, "", 0);
    }

    function test_updateWorkflow_revert_notFound() public {
        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(WorkflowNotFound.selector);
        registry.updateWorkflow(bytes32(uint256(999)), "Name", "Desc", "defi", caps, "", 0);
    }

    function test_updateWorkflow_revert_notActive() public {
        bytes32 workflowId = _publishTestWorkflow();

        vm.prank(creator);
        registry.deactivateWorkflow(workflowId);

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(WorkflowNotActive.selector);
        registry.updateWorkflow(workflowId, "Name", "Desc", "defi", caps, "", 0);
    }

    function test_updateWorkflow_revert_emptyName() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(EmptyName.selector);
        registry.updateWorkflow(workflowId, "", "Desc", "defi", caps, "", 0);
    }

    function test_updateWorkflow_revert_emptyCategory() public {
        bytes32 workflowId = _publishTestWorkflow();

        string[] memory caps = new string[](1);
        caps[0] = "HTTPClient";

        vm.prank(creator);
        vm.expectRevert(EmptyCategory.selector);
        registry.updateWorkflow(workflowId, "Name", "Desc", "", caps, "", 0);
    }

    // ========================================
    // Access Control Tests
    // ========================================

    function test_addAuthorizedSender() public {
        address newSender = address(0x10);
        registry.addAuthorizedSender(newSender);
        assertTrue(registry.isAuthorizedSender(newSender));
    }

    function test_removeAuthorizedSender() public {
        registry.removeAuthorizedSender(authorizedCaller);
        assertFalse(registry.isAuthorizedSender(authorizedCaller));
    }

    function test_addAuthorizedSender_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        registry.addAuthorizedSender(address(0x10));
    }

    function test_removeAuthorizedSender_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        registry.removeAuthorizedSender(authorizedCaller);
    }

    function test_isAuthorizedSender_false_byDefault() public view {
        assertFalse(registry.isAuthorizedSender(address(0x99)));
    }

    function test_addAuthorizedSender_emitsEvent() public {
        address newSender = address(0x20);

        vm.expectEmit(true, false, false, false);
        emit IAutopilotRegistry.AuthorizedSenderAdded(newSender);
        registry.addAuthorizedSender(newSender);
    }

    function test_removeAuthorizedSender_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit IAutopilotRegistry.AuthorizedSenderRemoved(authorizedCaller);
        registry.removeAuthorizedSender(authorizedCaller);
    }

    // ========================================
    // Fuzz Tests
    // ========================================

    function testFuzz_publishWorkflow(
        string calldata name,
        string calldata desc,
        string calldata cat
    ) public {
        vm.assume(bytes(name).length > 0);
        vm.assume(bytes(cat).length > 0);

        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](0);

        vm.prank(creator);
        bytes32 workflowId = registry.publishWorkflow(name, desc, cat, chains, caps, "", 0);

        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.creator, creator);
        assertEq(meta.name, name);
        assertEq(meta.category, cat);
        assertTrue(meta.active);
    }
}
