export const ErrorCodes = {
  PARSE_FAILED: "PARSE_FAILED",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  GENERATION_FAILED: "GENERATION_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  SIMULATION_FAILED: "SIMULATION_FAILED",
  PUBLISH_FAILED: "PUBLISH_FAILED",
  WORKFLOW_NOT_FOUND: "WORKFLOW_NOT_FOUND",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_INPUT: "INVALID_INPUT",
  CONTRACT_ERROR: "CONTRACT_ERROR",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  CRE_CLI_ERROR: "CRE_CLI_ERROR",
  DEPLOY_FAILED: "DEPLOY_FAILED",
  DEPLOY_TIMEOUT: "DEPLOY_TIMEOUT",
  DEPLOY_CONFLICT: "DEPLOY_CONFLICT",
  INSTALL_FAILED: "INSTALL_FAILED",
  WALLET_NOT_CONFIGURED: "WALLET_NOT_CONFIGURED",
  WORKFLOW_NOT_PUBLISHED: "WORKFLOW_NOT_PUBLISHED",
  AI_SERVICE_ERROR: "AI_SERVICE_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  RPC_ERROR: "RPC_ERROR",
  TX_TIMEOUT: "TX_TIMEOUT",
  DISCOVERY_FAILED: "DISCOVERY_FAILED",
  SSE_CAPACITY_FULL: "SSE_CAPACITY_FULL",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PIPELINE_NOT_FOUND: "PIPELINE_NOT_FOUND",
  PIPELINE_EXECUTION_FAILED: "PIPELINE_EXECUTION_FAILED",
  PIPELINE_DEACTIVATED: "PIPELINE_DEACTIVATED",
  SCHEMA_INCOMPATIBLE: "SCHEMA_INCOMPATIBLE",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly details?: unknown

  constructor(code: ErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    }
  }
}
