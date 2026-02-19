// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AutopilotConsumer.sol";
import "../src/AutopilotRegistry.sol";
import "../src/interfaces/Errors.sol";

contract AutopilotConsumerTest is Test {
    AutopilotConsumer public consumer;
    AutopilotRegistry public registry;

    address public deployer;
    address public authorizedSender = address(0x5);
    address public other = address(0x6);

    bytes32 public constant WORKFLOW_ID = bytes32(uint256(1));

    function setUp() public {
        deployer = address(this);
        consumer = new AutopilotConsumer();
        registry = new AutopilotRegistry();

        // Authorize the test sender
        consumer.addAuthorizedSender(authorizedSender);
    }

    // --- Helpers ---

    function _buildMetadata(bytes32 workflowId) internal pure returns (bytes memory) {
        return abi.encodePacked(workflowId);
    }

    function _sendReport(bytes32 workflowId, bytes memory report) internal {
        bytes memory metadata = _buildMetadata(workflowId);
        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);
    }

    // ========================================
    // onReport Tests
    // ========================================

    function test_onReport_storesLatestReport() public {
        bytes memory report = abi.encode(uint256(1850e8), uint256(block.timestamp));
        _sendReport(WORKFLOW_ID, report);

        (bytes memory stored, uint256 ts) = consumer.getLatestReport(WORKFLOW_ID);
        assertEq(stored, report);
        assertEq(ts, block.timestamp);
    }

    function test_onReport_incrementsCount() public {
        bytes memory report1 = abi.encode(uint256(1850e8));
        bytes memory report2 = abi.encode(uint256(1860e8));

        _sendReport(WORKFLOW_ID, report1);
        assertEq(consumer.getReportCount(WORKFLOW_ID), 1);

        _sendReport(WORKFLOW_ID, report2);
        assertEq(consumer.getReportCount(WORKFLOW_ID), 2);
    }

    function test_onReport_storesHistory() public {
        bytes memory report1 = abi.encode(uint256(1850e8));
        bytes memory report2 = abi.encode(uint256(1860e8));

        _sendReport(WORKFLOW_ID, report1);
        _sendReport(WORKFLOW_ID, report2);

        bytes memory first = consumer.getReport(WORKFLOW_ID, 0);
        bytes memory second = consumer.getReport(WORKFLOW_ID, 1);

        assertEq(first, report1);
        assertEq(second, report2);
    }

    function test_onReport_emitsEvent() public {
        bytes memory metadata = _buildMetadata(WORKFLOW_ID);
        bytes memory report = abi.encode(uint256(42));

        vm.expectEmit(true, true, false, true);
        emit AutopilotConsumer.ReportReceived(
            WORKFLOW_ID,
            authorizedSender,
            block.timestamp,
            report.length
        );

        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);
    }

    function test_onReport_shortMetadata() public {
        // Metadata shorter than 32 bytes uses keccak hash as workflow ID
        bytes memory metadata = hex"deadbeef";
        bytes memory report = abi.encode(uint256(100));

        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);

        bytes32 expectedId = keccak256(metadata);
        assertEq(consumer.getReportCount(expectedId), 1);
    }

    function test_onReport_updatesLatest() public {
        bytes memory report1 = abi.encode(uint256(100));
        bytes memory report2 = abi.encode(uint256(200));

        _sendReport(WORKFLOW_ID, report1);
        _sendReport(WORKFLOW_ID, report2);

        (bytes memory latest,) = consumer.getLatestReport(WORKFLOW_ID);
        assertEq(latest, report2);
    }

    function test_getReport_revert_outOfBounds() public {
        vm.expectRevert(ReportIndexOutOfBounds.selector);
        consumer.getReport(WORKFLOW_ID, 0);
    }

    function test_getAllReports_paginated() public {
        _sendReport(WORKFLOW_ID, abi.encode(uint256(1)));
        _sendReport(WORKFLOW_ID, abi.encode(uint256(2)));
        _sendReport(WORKFLOW_ID, abi.encode(uint256(3)));

        (bytes[] memory all, uint256 total) = consumer.getAllReports(WORKFLOW_ID, 0, 100);
        assertEq(total, 3);
        assertEq(all.length, 3);
    }

    // ========================================
    // Access Control Tests
    // ========================================

    function test_onReport_revert_unauthorized() public {
        bytes memory metadata = _buildMetadata(WORKFLOW_ID);
        bytes memory report = abi.encode(uint256(42));

        vm.prank(other);
        vm.expectRevert(NotAuthorizedSender.selector);
        consumer.onReport(metadata, report);
    }

    function test_addAuthorizedSender() public {
        address newSender = address(0x10);
        consumer.addAuthorizedSender(newSender);
        assertTrue(consumer.isAuthorizedSender(newSender));
    }

    function test_removeAuthorizedSender() public {
        consumer.removeAuthorizedSender(authorizedSender);
        assertFalse(consumer.isAuthorizedSender(authorizedSender));
    }

    function test_addAuthorizedSender_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        consumer.addAuthorizedSender(address(0x10));
    }

    function test_removeAuthorizedSender_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        consumer.removeAuthorizedSender(authorizedSender);
    }

    // ========================================
    // Registry Bridge Tests
    // ========================================

    function test_setRegistry() public {
        consumer.setRegistry(address(registry));
        assertEq(address(consumer.registry()), address(registry));
    }

    function test_setRegistry_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        consumer.setRegistry(address(registry));
    }

    function test_setRegistry_disableWithZeroAddress() public {
        consumer.setRegistry(address(registry));
        consumer.setRegistry(address(0));
        assertEq(address(consumer.registry()), address(0));
    }

    function test_setRegistry_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit AutopilotConsumer.RegistryUpdated(address(registry));
        consumer.setRegistry(address(registry));
    }

    function test_onReport_bridgeCallsRegistry() public {
        // Set up the full bridge: consumer → registry
        consumer.setRegistry(address(registry));
        registry.addAuthorizedSender(address(consumer));

        // Publish a workflow so it exists in registry
        uint64[] memory chains = new uint64[](1);
        chains[0] = 10344971235874465080;
        string[] memory caps = new string[](0);

        vm.prank(address(0x1));
        bytes32 workflowId = registry.publishWorkflow("Test", "Desc", "defi", chains, caps, "", 0);

        // Send a report — should bridge to registry.recordExecution
        bytes memory metadata = _buildMetadata(workflowId);
        vm.prank(authorizedSender);
        consumer.onReport(metadata, abi.encode(uint256(42)));

        // Verify execution was recorded
        AutopilotRegistry.WorkflowMetadata memory meta = registry.getWorkflow(workflowId);
        assertEq(meta.totalExecutions, 1);
        assertEq(meta.successfulExecutions, 1);
    }

    function test_onReport_bridgeFailureDoesNotRevert() public {
        // Set registry but DON'T authorize consumer — bridge call will revert internally
        consumer.setRegistry(address(registry));
        // Not calling: registry.addAuthorizedSender(address(consumer))

        // onReport should still succeed (try/catch)
        bytes memory metadata = _buildMetadata(WORKFLOW_ID);
        vm.prank(authorizedSender);
        consumer.onReport(metadata, abi.encode(uint256(42)));

        // Report was still stored
        assertEq(consumer.getReportCount(WORKFLOW_ID), 1);
    }

    // ========================================
    // Circular Buffer Tests
    // ========================================

    function test_circularBuffer_fillsNormally() public {
        // Send 5 reports — all should be stored normally
        for (uint256 i = 0; i < 5; i++) {
            _sendReport(WORKFLOW_ID, abi.encode(i));
        }

        assertEq(consumer.getReportCount(WORKFLOW_ID), 5);

        (bytes[] memory reports, uint256 total) = consumer.getAllReports(WORKFLOW_ID, 0, 10);
        assertEq(total, 5);
        assertEq(reports.length, 5);
    }

    function test_circularBuffer_wrapsAtMax() public {
        uint256 maxReports = consumer.MAX_REPORT_HISTORY();

        // Fill buffer to max
        for (uint256 i = 0; i < maxReports; i++) {
            _sendReport(WORKFLOW_ID, abi.encode(i));
        }

        assertEq(consumer.getReportCount(WORKFLOW_ID), maxReports);

        // Send 5 more — should overwrite oldest
        for (uint256 i = 0; i < 5; i++) {
            _sendReport(WORKFLOW_ID, abi.encode(maxReports + i));
        }

        // Total count tracks all reports ever received
        assertEq(consumer.getReportCount(WORKFLOW_ID), maxReports + 5);

        // But stored buffer is capped at MAX_REPORT_HISTORY
        (, uint256 storedTotal) = consumer.getAllReports(WORKFLOW_ID, 0, 1);
        assertEq(storedTotal, maxReports);

        // First entry should be overwritten (was 0, now should be maxReports)
        bytes memory firstReport = consumer.getReport(WORKFLOW_ID, 0);
        assertEq(abi.decode(firstReport, (uint256)), maxReports);
    }

    // ========================================
    // Pagination Tests
    // ========================================

    function test_getAllReports_offsetBeyondTotal() public {
        _sendReport(WORKFLOW_ID, abi.encode(uint256(1)));

        (bytes[] memory reports, uint256 total) = consumer.getAllReports(WORKFLOW_ID, 100, 10);
        assertEq(total, 1);
        assertEq(reports.length, 0);
    }

    function test_getAllReports_limitZero() public {
        _sendReport(WORKFLOW_ID, abi.encode(uint256(1)));

        (bytes[] memory reports, uint256 total) = consumer.getAllReports(WORKFLOW_ID, 0, 0);
        assertEq(total, 1);
        assertEq(reports.length, 0);
    }

    function test_getAllReports_limitExceedsRemaining() public {
        _sendReport(WORKFLOW_ID, abi.encode(uint256(1)));

        (bytes[] memory reports, uint256 total) = consumer.getAllReports(WORKFLOW_ID, 0, 100);
        assertEq(total, 1);
        assertEq(reports.length, 1);
    }

    // ========================================
    // Fuzz Tests
    // ========================================

    function testFuzz_onReport(bytes calldata metadata, bytes calldata report) public {
        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);

        bytes32 expectedId;
        if (metadata.length >= 32) {
            expectedId = bytes32(metadata[:32]);
        } else {
            expectedId = keccak256(metadata);
        }

        assertEq(consumer.getReportCount(expectedId), 1);
        (bytes memory stored,) = consumer.getLatestReport(expectedId);
        assertEq(stored, report);
    }
}
