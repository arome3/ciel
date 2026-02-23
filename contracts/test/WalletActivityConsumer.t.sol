// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WalletActivityConsumer.sol";

contract WalletActivityConsumerTest is Test {
    WalletActivityConsumer public consumer;
    address public owner;
    address public sender;

    function setUp() public {
        owner = address(this);
        sender = address(0xBEEF);
        consumer = new WalletActivityConsumer();
        consumer.addAuthorizedSender(sender);
    }

    function _buildReport(address from, address to, uint256 value, uint256 ts)
        internal pure returns (bytes memory)
    {
        return abi.encode(from, to, value, ts);
    }

    function _sendReport(address from, address to, uint256 value, uint256 ts) internal {
        vm.prank(sender);
        consumer.onReport("", _buildReport(from, to, value, ts));
    }

    // --- Lifecycle ---

    function test_initialState() public view {
        WalletActivityConsumer.TransferReport memory r = consumer.getLatestReport();
        assertEq(r.from, address(0));
        assertEq(r.value, 0);
        assertEq(consumer.getReportCount(), 0);
    }

    function test_onReport_storesResult() public {
        _sendReport(address(0xA), address(0xB), 1e18, 1000);
        WalletActivityConsumer.TransferReport memory r = consumer.getLatestReport();
        assertEq(r.from, address(0xA));
        assertEq(r.to, address(0xB));
        assertEq(r.value, 1e18);
        assertEq(r.timestamp, 1000);
        assertEq(consumer.getReportCount(), 1);
    }

    function test_onReport_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit WalletActivityConsumer.TransferReported(
            address(0xA), address(0xB), 1e18, 1000
        );
        _sendReport(address(0xA), address(0xB), 1e18, 1000);
    }

    function test_onReport_appendsHistory() public {
        _sendReport(address(0xA), address(0xB), 1e18, 1000);
        _sendReport(address(0xC), address(0xD), 2e18, 2000);
        assertEq(consumer.getReportCount(), 2);
        WalletActivityConsumer.TransferReport memory first = consumer.getReport(0);
        assertEq(first.from, address(0xA));
        WalletActivityConsumer.TransferReport memory second = consumer.getReport(1);
        assertEq(second.from, address(0xC));
    }

    // --- Access Control ---

    function test_revert_unauthorizedSender() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(NotAuthorizedSender.selector);
        consumer.onReport("", _buildReport(address(0xA), address(0xB), 1e18, 1000));
    }

    function test_addAndRemoveSender() public {
        address newSender = address(0xCAFE);
        consumer.addAuthorizedSender(newSender);
        assertTrue(consumer.isAuthorizedSender(newSender));
        consumer.removeAuthorizedSender(newSender);
        assertFalse(consumer.isAuthorizedSender(newSender));
    }

    // --- Ring Buffer ---

    function test_ringBuffer_wrapsAtMAX_HISTORY() public {
        uint256 max = consumer.MAX_HISTORY();
        for (uint256 i = 0; i < max + 5; i++) {
            _sendReport(address(uint160(i + 1)), address(0xB), i * 1e18, i);
        }
        assertTrue(consumer.isHistoryWrapped());
        assertEq(consumer.getReportCount(), max);
    }

    function test_ringBuffer_getReport_afterWrap() public {
        uint256 max = consumer.MAX_HISTORY();
        for (uint256 i = 0; i < max; i++) {
            _sendReport(address(uint160(i + 1)), address(0xB), i * 1e18, i);
        }
        // Slot 0 should be report from i=0 (from=0x1)
        WalletActivityConsumer.TransferReport memory r0 = consumer.getReport(0);
        assertEq(r0.from, address(1));

        // Write one more — overwrites slot 0
        _sendReport(address(0xDEAD), address(0xBEEF), 999e18, 9999);
        WalletActivityConsumer.TransferReport memory overwritten = consumer.getReport(0);
        assertEq(overwritten.from, address(0xDEAD));
        assertEq(overwritten.value, 999e18);
    }

    function test_ringBuffer_getReportCount_capsAtMAX_HISTORY() public {
        uint256 max = consumer.MAX_HISTORY();
        // Fill to capacity
        for (uint256 i = 0; i < max; i++) {
            _sendReport(address(uint160(i + 1)), address(0xB), 1e18, i);
        }
        assertEq(consumer.getReportCount(), max);
        assertFalse(consumer.isHistoryWrapped());

        // One more triggers wrap
        _sendReport(address(0xCAFE), address(0xB), 1e18, max);
        assertEq(consumer.getReportCount(), max);
        assertTrue(consumer.isHistoryWrapped());

        // Many more still caps at max
        for (uint256 i = 0; i < 50; i++) {
            _sendReport(address(uint160(i + 1)), address(0xB), 1e18, max + i + 1);
        }
        assertEq(consumer.getReportCount(), max);
    }

    // --- Fuzz ---

    function testFuzz_onReport_anyValues(address from, address to, uint256 value, uint256 ts) public {
        _sendReport(from, to, value, ts);
        WalletActivityConsumer.TransferReport memory r = consumer.getLatestReport();
        assertEq(r.from, from);
        assertEq(r.to, to);
        assertEq(r.value, value);
        assertEq(r.timestamp, ts);
    }
}
