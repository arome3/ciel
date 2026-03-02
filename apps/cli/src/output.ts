let jsonMode = false
let colorEnabled = true

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled
}

export function setNoColor(disabled: boolean): void {
  colorEnabled = !disabled
}

export function isJsonMode(): boolean {
  return jsonMode
}

// ANSI color helpers
function c(code: number, text: string): string {
  if (!colorEnabled) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

const green = (t: string) => c(32, t)
const red = (t: string) => c(31, t)
const yellow = (t: string) => c(33, t)
const cyan = (t: string) => c(36, t)
const dim = (t: string) => c(2, t)
const bold = (t: string) => c(1, t)

// ── Human-readable output ──

export function header(text: string): void {
  if (jsonMode) return
  console.log()
  console.log(bold(text))
  console.log(dim("─".repeat(Math.min(text.length + 4, 60))))
}

export function field(label: string, value: unknown): void {
  if (jsonMode) return
  const v = value === null || value === undefined ? dim("–") : String(value)
  console.log(`  ${dim(label + ":")} ${v}`)
}

export function success(message: string): void {
  if (jsonMode) return
  console.log(green("✓") + " " + message)
}

export function warn(message: string): void {
  if (jsonMode) return
  console.log(yellow("⚠") + " " + message)
}

export function error(message: string): void {
  if (jsonMode) {
    console.error(JSON.stringify({ error: message }))
    return
  }
  console.error(red("✗") + " " + message)
}

export function hint(message: string): void {
  if (jsonMode) return
  console.log()
  console.log(dim("→ " + message))
}

export function info(message: string): void {
  if (jsonMode) return
  console.log(dim(message))
}

export function code(text: string, language?: string): void {
  if (jsonMode) return
  console.log()
  if (language) console.log(dim(`── ${language} ──`))
  console.log(text)
  if (language) console.log(dim("─".repeat(20)))
}

export function table(headers: string[], rows: string[][]): void {
  if (jsonMode) return

  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0)
    return Math.max(h.length, maxRow)
  })

  const headerLine = headers.map((h, i) => bold(h.padEnd(widths[i]))).join("  ")
  const separator = widths.map(w => "─".repeat(w)).join("──")

  console.log()
  console.log(headerLine)
  console.log(dim(separator))
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  "))
  }
}

export function statusIcon(status: string): string {
  if (!colorEnabled) {
    const icons: Record<string, string> = {
      success: "[OK]", passed: "[OK]", deployed: "[OK]",
      failed: "[FAIL]", error: "[FAIL]",
      pending: "[..]", running: "[..]",
      skipped: "[--]",
    }
    return icons[status] ?? `[${status}]`
  }
  const icons: Record<string, string> = {
    success: green("✓"), passed: green("✓"), deployed: green("✓"),
    failed: red("✗"), error: red("✗"),
    pending: yellow("○"), running: yellow("◉"),
    skipped: dim("–"),
  }
  return icons[status] ?? dim(`[${status}]`)
}

export function traceStep(step: string, status: string, detail?: string): void {
  if (jsonMode) return
  const icon = statusIcon(status)
  const suffix = detail ? dim(` (${detail})`) : ""
  console.log(`  ${icon} ${step}${suffix}`)
}

// ── JSON output ──

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
