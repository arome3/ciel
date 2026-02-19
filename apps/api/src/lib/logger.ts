type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function resolveLevel(): LogLevel {
  const env = process.env.NODE_ENV
  if (env === "production") return "info"
  if (env === "test") return "error"
  return "debug"
}

const currentLevel = resolveLevel()

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]
}

export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export function createLogger(component: string): Logger {
  const tag = `[${component}]`

  const log = (level: LogLevel, message: string, data?: unknown) => {
    if (!shouldLog(level)) return
    const fn = level === "debug" ? console.debug
      : level === "info" ? console.log
      : level === "warn" ? console.warn
      : console.error
    if (data !== undefined) {
      fn(`${tag} ${message}`, data)
    } else {
      fn(`${tag} ${message}`)
    }
  }

  return {
    debug: (msg, data?) => log("debug", msg, data),
    info: (msg, data?) => log("info", msg, data),
    warn: (msg, data?) => log("warn", msg, data),
    error: (msg, data?) => log("error", msg, data),
  }
}
