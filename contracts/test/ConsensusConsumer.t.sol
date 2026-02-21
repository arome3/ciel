// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ConsensusConsumer.sol";
import "../src/interfaces/Errors.sol";

contract ConsensusConsumerTest is Test {
    ConsensusConsumer public consumer;

    address public deployer;
    address public authorizedSender = address(0x5);
    address public other = address(0x6);

    function setUp() public {
        deployer = address(this);
        consumer = new ConsensusConsumer();

        // Authorize the test sender
        consumer.addAuthorizedSender(authorizedSender);
    }

    // --- Helpers ---

    function _buildReport(
        string memory answer,
        uint256 confidence,
        uint256 modelsAgreed
    ) internal pure returns (bytes memory) {
        return abi.encode(answer, confidence, modelsAgreed);
    }

    function _sendReport(bytes memory report) internal {
        bytes memory metadata = abi.encodePacked(bytes32(uint256(1)));
        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);
    }

    // ========================================
    // onReport Tests
    // ========================================

    function test_onReport_storesResult() public {
        bytes memory report = _buildReport("yes", 1000, 3);
        _sendReport(report);

        ConsensusConsumer.OracleResult memory result = consumer.getLatestResult();
        assertEq(result.answer, "yes");
        assertEq(result.confidence, 1000);
        assertEq(result.modelsAgreed, 3);
        assertEq(result.timestamp, block.timestamp);
        assertEq(result.reportHash, keccak256(report));
    }

    function test_onReport_emitsResultReceived() public {
        bytes memory report = _buildReport("no", 667, 2);

        vm.expectEmit(false, false, false, true);
        emit ConsensusConsumer.ResultReceived("no", 667, 2, block.timestamp);

        bytes memory metadata = abi.encodePacked(bytes32(uint256(1)));
        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);
    }

    function test_onReport_revert_unauthorized() public {
        bytes memory metadata = abi.encodePacked(bytes32(uint256(1)));
        bytes memory report = _buildReport("yes", 1000, 3);

        vm.prank(other);
        vm.expectRevert(NotAuthorizedSender.selector);
        consumer.onReport(metadata, report);
    }

    function test_onReport_updatesOnSubsequentCall() public {
        bytes memory report1 = _buildReport("yes", 1000, 3);
        bytes memory report2 = _buildReport("no", 667, 2);

        _sendReport(report1);
        _sendReport(report2);

        ConsensusConsumer.OracleResult memory result = consumer.getLatestResult();
        assertEq(result.answer, "no");
        assertEq(result.confidence, 667);
        assertEq(result.modelsAgreed, 2);
    }

    // ========================================
    // Access Control Tests
    // ========================================

    function test_addAuthorizedSender() public {
        address newSender = address(0x10);
        consumer.addAuthorizedSender(newSender);
        assertTrue(consumer.isAuthorizedSender(newSender));
    }

    function test_addAuthorizedSender_revert_notOwner() public {
        vm.prank(other);
        vm.expectRevert();
        consumer.addAuthorizedSender(address(0x10));
    }

    function test_removeAuthorizedSender() public {
        consumer.removeAuthorizedSender(authorizedSender);
        assertFalse(consumer.isAuthorizedSender(authorizedSender));
    }

    function test_addAuthorizedSender_emitsEvent() public {
        address newSender = address(0x20);

        vm.expectEmit(true, false, false, false);
        emit ConsensusConsumer.SenderAuthorized(newSender);

        consumer.addAuthorizedSender(newSender);
    }

    function test_removeAuthorizedSender_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ConsensusConsumer.SenderUnauthorized(authorizedSender);

        consumer.removeAuthorizedSender(authorizedSender);
    }

    // ========================================
    // Read Function Tests
    // ========================================

    function test_getLatestResult_returnsFullStruct() public {
        bytes memory report = _buildReport("uncertain", 333, 1);
        _sendReport(report);

        ConsensusConsumer.OracleResult memory result = consumer.getLatestResult();

        // Verify all struct fields are populated correctly
        assertEq(result.answer, "uncertain");
        assertEq(result.confidence, 333);
        assertEq(result.modelsAgreed, 1);
        assertTrue(result.timestamp > 0);
        assertTrue(result.reportHash != bytes32(0));
    }

    function test_reportHash_isKeccak() public {
        bytes memory report = _buildReport("yes", 1000, 3);
        _sendReport(report);

        ConsensusConsumer.OracleResult memory result = consumer.getLatestResult();
        assertEq(result.reportHash, keccak256(report));
    }

    // ========================================
    // Fuzz Tests
    // ========================================

    function testFuzz_onReport(
        string calldata answer,
        uint256 confidence,
        uint256 modelsAgreed
    ) public {
        bytes memory report = abi.encode(answer, confidence, modelsAgreed);
        bytes memory metadata = abi.encodePacked(bytes32(uint256(42)));

        vm.prank(authorizedSender);
        consumer.onReport(metadata, report);

        ConsensusConsumer.OracleResult memory result = consumer.getLatestResult();
        assertEq(result.answer, answer);
        assertEq(result.confidence, confidence);
        assertEq(result.modelsAgreed, modelsAgreed);
        assertEq(result.reportHash, keccak256(report));
    }
}
