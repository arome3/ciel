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
  AI_SERVICE_ERROR: "AI_SERVICE_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  RPC_ERROR: "RPC_ERROR",
  TX_TIMEOUT: "TX_TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
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
