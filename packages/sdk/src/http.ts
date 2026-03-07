import { CielSDKError } from "./types"

export class HttpClient {
  private baseUrl: string
  private timeout: number

  constructor(baseUrl: string, timeout: number = 30_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.timeout = timeout
  }

  async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    try {
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeout),
        ...options,
      })

      if (!res.ok) {
        let message = `Request failed (${res.status})`
        try {
          const body = await res.json()
          if (body.error?.message) message = body.error.message
          else if (body.message) message = body.message
        } catch { /* use default message */ }
        throw new CielSDKError("API_ERROR", message, res.status)
      }

      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof CielSDKError) throw err
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("connect"))) {
        throw new CielSDKError("API_UNREACHABLE", `Cannot connect to Ciel API at ${this.baseUrl}`)
      }
      throw err
    }
  }
}

export function qs(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return ""
  const query = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) query.set(key, String(val))
  }
  const str = query.toString()
  return str ? `?${str}` : ""
}
