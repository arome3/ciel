export class CliError extends Error {
  public readonly code: string
  public readonly exitCode: number
  public readonly details?: unknown

  constructor(code: string, message: string, exitCode = 1, details?: unknown) {
    super(message)
    this.code = code
    this.exitCode = exitCode
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

export function apiUnreachable(url: string): CliError {
  return new CliError(
    "API_UNREACHABLE",
    `Cannot connect to Ciel API at ${url}. Is the server running?`,
  )
}

export function authRequired(): CliError {
  return new CliError(
    "AUTH_REQUIRED",
    "This command requires authentication. Set CIEL_PRIVATE_KEY or use --private-key.",
  )
}

export function apiError(statusCode: number, message: string, details?: unknown): CliError {
  return new CliError(
    "API_ERROR",
    `API error (${statusCode}): ${message}`,
    1,
    details,
  )
}

export function fileNotFound(path: string): CliError {
  return new CliError(
    "FILE_NOT_FOUND",
    `File not found: ${path}`,
  )
}

export function invalidInput(message: string): CliError {
  return new CliError(
    "INVALID_INPUT",
    message,
  )
}
