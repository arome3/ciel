// agent/src/logger.ts — Demo-formatted terminal output with ANSI styling

const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const YELLOW = "\x1b[33m"
const WHITE = "\x1b[37m"

const STEP_DELAY = 800
const DETAIL_DELAY = 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function step(msg: string, delayMs = STEP_DELAY): Promise<void> {
  console.log(`\n${BOLD}${WHITE}▸ ${msg}${RESET}`)
  if (delayMs > 0) await sleep(delayMs)
}

export async function detail(msg: string, delayMs = DETAIL_DELAY): Promise<void> {
  console.log(`${DIM}  ${msg}${RESET}`)
  if (delayMs > 0) await sleep(delayMs)
}

export function done(msg: string): void {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`)
}

export function error(msg: string): void {
  console.log(`${RED}  ✗ ${msg}${RESET}`)
}

export function warn(msg: string): void {
  console.log(`${YELLOW}  ⚠ ${msg}${RESET}`)
}

export function separator(): void {
  console.log(`${DIM}${"─".repeat(52)}${RESET}`)
}

export function banner(title: string, subtitle?: string): void {
  const width = 52
  const pad = (s: string) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "")
    const left = Math.max(0, Math.floor((width - 2 - visible.length) / 2))
    const right = Math.max(0, width - 2 - left - visible.length)
    return `${CYAN}│${RESET}${" ".repeat(left)}${s}${" ".repeat(right)}${CYAN}│${RESET}`
  }

  console.log()
  console.log(`${CYAN}╭${"─".repeat(width - 2)}╮${RESET}`)
  console.log(pad(""))
  console.log(pad(`${BOLD}${WHITE}${title}${RESET}`))
  if (subtitle) {
    console.log(pad(`${DIM}${subtitle}${RESET}`))
  }
  console.log(pad(""))
  console.log(`${CYAN}╰${"─".repeat(width - 2)}╯${RESET}`)
}
