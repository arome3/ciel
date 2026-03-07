export async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl}${path}`

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
    ...options,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.error?.message) message = body.error.message
      else if (body.message) message = body.message
    } catch { /* use default message */ }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export function qs(params?: Record<string, string | undefined>): string {
  if (!params) return ""
  const query = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) query.set(key, val)
  }
  const str = query.toString()
  return str ? `?${str}` : ""
}
