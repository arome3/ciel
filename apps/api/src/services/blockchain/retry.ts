import { createLogger } from "../../lib/logger"

const log = createLogger("Retry")

export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
}

const RETRYABLE_PATTERNS = [
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "socket hang up",
  "429",
  "502",
  "503",
  "504",
  "rate limit",
]

const REVERT_PATTERNS = [
  "revert",
  "execution reverted",
  "CALL_EXCEPTION",
  "ContractFunctionExecutionError",
]

export function isRetryableRpcError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  // Never retry contract reverts
  if (REVERT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) {
    return false
  }

  return RETRYABLE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay } = { ...DEFAULT_OPTIONS, ...opts }

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt >= maxRetries || !isRetryableRpcError(err)) {
        throw err
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      log.debug(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      })

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
