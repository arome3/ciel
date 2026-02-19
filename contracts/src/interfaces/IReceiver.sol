// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReceiver
/// @notice Interface for contracts that receive CRE workflow reports
interface IReceiver {
    /// @notice Called by CRE DON to deliver a report
    /// @param metadata Encoded metadata (workflow ID, trigger info)
    /// @param report Encoded report data
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
