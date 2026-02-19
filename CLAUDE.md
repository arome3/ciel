# Ciel — Production Coding Standards

## Project Structure

```
apps/api/        Express backend (bun runtime)
apps/web/        Next.js frontend
contracts/       Foundry Solidity contracts
agent/           Demo agent
packages/        Shared packages
```

**Monorepo:** bun workspaces + turbo

## Production Code Standards

- Every new module MUST have a corresponding test file in `__tests__/`
- All error paths handled with `AppError(code, statusCode, message, details?)` — no raw `throw new Error()`
- No raw `JSON.parse` without try/catch at API boundaries
- All subprocess spawns MUST have timeouts and `proc.kill()` on timeout
- All acquired resources (semaphore slots, temp dirs, file handles) released in `finally` blocks
- Stdout/stderr from child processes MUST be size-limited (2MB cap)
- Input validation at API boundaries with size limits (Zod schemas)
- Non-blocking DB operations in response-critical paths (catch + log, never fail response)
- No semicolons — entire codebase omits trailing semicolons

## Error Handling

```ts
import { AppError, ErrorCodes } from "../types/errors"

// Throw structured errors — never raw Error
throw new AppError(ErrorCodes.WORKFLOW_NOT_FOUND, 404, "Workflow not found")

// Routes pass errors to Express error handler
catch (err) { next(err) }
```

Error codes live in `apps/api/src/types/errors.ts`. Add new codes there, not inline strings.

## Testing

- Framework: `bun:test`
- Test files: `apps/api/src/__tests__/*.test.ts`
- Mock strategy: `mock.module()` at external boundaries (OpenAI, DB, config), NOT intermediate modules
- Use absolute paths with `resolve(import.meta.dir, "..")` for mock.module paths
- Dynamic `import()` for modules loaded after mocks register
- Test-only introspection exports use `_` prefix (e.g., `_getSimState()`, `_resetOpenAIClient()`)

## Logging

```ts
import { createLogger } from "../lib/logger"
const log = createLogger("ComponentName")

log.info("message")           // tagged [ComponentName] message
log.debug("detail", { data }) // only in development
```

Level gating by NODE_ENV: production → info, test → error, development → debug.

## Commands

```bash
# From apps/api/
bun dev              # Start dev server
bun test             # Run all tests
bunx tsc --noEmit    # Type check
```
