// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared error definitions for Ciel contracts

error Unauthorized();
error NotAuthorizedSender();
error WorkflowNotFound();
error WorkflowNotActive();
error WorkflowAlreadyActive();
error WorkflowIdCollision();
error EmptyName();
error EmptyCategory();
error NoChainsProvided();
error ReportIndexOutOfBounds();
error InvalidPaginationParams();
