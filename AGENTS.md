<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## OpenCrewBot 2.0 conventions

These rules apply to everything added on top of the original OpenCrewBot. Several are adapted from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

**Readability first**
- Write code a reviewer can follow in one pass: small named functions, plain control flow, no clever one-liners.
- Every new module starts with a comment saying what it is for. Every export has a short JSDoc with `@param` / `@returns` / `@throws` where they aren't obvious.
- Comments explain *why* and state facts the code can't show (limits, failure behaviour, sources of data). They don't restate the code.

**Design**
- **Extend through documented extension points, not by rewriting the loop.** Use Mastra's Agent options, processors and tools; keep `runtime.ts`'s turn flow intact.
- **Defaults are decided in one explicit place.** Write a named `resolve…()` function (e.g. `resolveModelChain`), not a `?? default` hidden deep inside other logic.
- **Deployment choices are configuration.** Anything that varies per install (keys, default model, mock mode, data dir) comes from env vars documented in `.env.example` and the README.
- **Misconfiguration fails loudly**, with a message that names the fix (which env var, which setting). Never silently skip or substitute a missing piece.
- **One home per fact.** Facts both sides need go in `src/lib/shared/` (plain data and pure functions); secrets and env access stay in `src/lib/server/`.
- **Prefer maintained dependencies over hand-rolling** (e.g. Mastra's fallback list instead of our own retry loop).

**Types and errors**
- `strict` TypeScript. Don't add `as unknown`; a necessary cast gets a one-line comment proving it's safe.
- Validate at real boundaries (HTTP input, env vars, model/tool JSON, files), and trust types inside the process.
- Expected failures use an error class with a stable `UPPER_SNAKE_CASE` `code` (e.g. `ModelConfigError` / `MODEL_PROVIDER_NOT_CONFIGURED`). Never route on message text.
- A `catch` that swallows an error says in a comment which failure is expected and why that's safe.

**Honesty**
- Label live vs. simulated output. Never present mock data or a mocked integration as live.
- Data with a source (prices, model lists) says where it came from and when it was checked.

**Checks before a change is done**
- `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm test` pass.
- New behaviour gets a test in `tests/` that describes the behaviour (not the implementation). Tests never read `.env`; they set the env vars they need.
- Every new tool is classified in `toolCategory()` (tools.ts). An unclassified tool falls into "other", which always asks.
- The changed behaviour was exercised for real (or with the mock model) and the result recorded.
- Docs that describe the changed behaviour (README, `.env.example`, `docs/FEATURE_AUDIT.md`) are updated in the same change.
