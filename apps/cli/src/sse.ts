import { isJsonMode } from "./output"

export type EventHandler = (type: string, data: Record<string, unknown>) => void

export async function streamEvents(
  response: Response,
  handler: EventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let currentType = "message"
  let currentData = ""

  try {
    while (true) {
      if (signal?.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentType = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim()
        } else if (line === "") {
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData) as Record<string, unknown>
              handler(currentType, parsed)
            } catch {
              // skip malformed events
            }
          }
          currentType = "message"
          currentData = ""
        }
        // ":" lines are keepalive comments — ignored
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function defaultEventHandler(type: string, data: Record<string, unknown>): void {
  if (type === "system") return

  if (isJsonMode()) {
    console.log(JSON.stringify({ type, ...data }))
    return
  }

  const timestamp = new Date().toLocaleTimeString()
  const summary = formatEventSummary(type, data)
  console.log(`  \x1b[2m${timestamp}\x1b[0m  \x1b[36m${type}\x1b[0m  ${summary}`)
}

function formatEventSummary(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "execution":
      return `workflow=${data.workflowId} status=${data.status}`
    case "deploy":
      return `workflow=${data.workflowId} status=${data.status}`
    case "publish":
      return `workflow=${data.workflowId} name="${data.name}"`
    case "pipeline_started":
      return `pipeline=${data.pipelineId}`
    case "pipeline_step_completed":
      return `pipeline=${data.pipelineId} step=${data.stepIndex}`
    case "pipeline_step_failed":
      return `pipeline=${data.pipelineId} step=${data.stepIndex} error="${data.error}"`
    case "pipeline_completed":
      return `pipeline=${data.pipelineId} duration=${data.duration}ms`
    case "pipeline_failed":
      return `pipeline=${data.pipelineId} error="${data.error}"`
    default:
      return JSON.stringify(data)
  }
}
