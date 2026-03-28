# CLAUDE.md — [Product Name]

This file is read by Claude Code at the start of every session. Keep it concise and factual.
Replace all placeholder text in [brackets] and delete this instruction line before committing.

---

## Project overview

[One paragraph. What does this product do? Who uses it? What problem does it solve?
Include the tech stack in one line, e.g. "Node.js 20 / TypeScript / Fastify / PostgreSQL".]

**Tech stack:** [Language, framework, database, hosting platform]
**Repo:** `forgedTechApps/[repo-name]`
**Environments:** development (Railway/Vercel/other — dev branch), production (main branch)

---

## Architecture

[Key directories and what lives in each. Focus on where code actually is, not aspirational structure.]

```
src/
  [module-a]/     — [what it does]
  [module-b]/     — [what it does]
  shared/         — [shared utilities, types, constants]
test/
  unit/           — [pure unit tests, no I/O]
  integration/    — [tests hitting real DB / external services]
  e2e/            — [full-stack tests against running server]
```

[One paragraph describing how the code fits together: request flow, data flow, key
boundaries between modules. Mention any non-obvious structural decisions.]

---

## Development workflow

**Prerequisites:** [Node 20 / Flutter 3.x / Xcode 15 / etc. — whatever must be installed]

```bash
# Install dependencies
[command]

# Run locally
[command]

# Run with hot reload
[command]

# Any required env vars for local dev — list names only, not values
cp .env.example .env
```

**Key environment variables:**
- `[VAR_NAME]` — [what it controls]
- `[VAR_NAME]` — [what it controls]

---

## Testing

```bash
# Unit tests
[command]      # e.g. npm run test:unit

# Integration tests
[command]      # e.g. npm run test:integration

# E2E tests (requires running server)
[command]      # e.g. npm run test:e2e

# All tests
[command]
```

**Test locations:**
- Unit tests: `test/unit/` — [what is tested here, what patterns are used]
- Integration tests: `test/integration/` — [what is tested, what dependencies are needed]
- E2E tests: `test/e2e/` — [what is tested, how to set up the target server]

**Coverage thresholds:** unit [X]%, integration [X]%

**Patterns used:** [e.g. "jest with ts-jest, supertest for HTTP assertions, testcontainers
for DB integration tests"]

---

## Conventions

**Naming:**
- [e.g. "Files: kebab-case. Classes: PascalCase. Functions/vars: camelCase."]
- [e.g. "Test files: foo.test.ts co-located with source, or foo.spec.ts in test/"]

**Code style:**
- [e.g. "ESLint + Prettier enforced in CI. Run `npm run lint:fix` before committing."]
- [e.g. "No default exports — always named exports."]
- [e.g. "Async/await throughout — no raw Promises or callbacks."]

**Patterns to follow:**
- [e.g. "Use the repository pattern for all DB access — never query directly from routes."]
- [e.g. "All errors must be typed — extend AppError for domain errors."]
- [e.g. "Feature flags via config, not code branches."]

**Patterns to avoid:**
- [e.g. "Do not use any — use unknown and narrow. CI enforces no-explicit-any."]
- [e.g. "Do not import from index barrel files inside the same module — use direct paths."]
- [e.g. "Do not catch errors silently — always log or re-throw with context."]

---

## Key decisions

[Document architectural decisions that affect how you write code. Focus on the why, not the what.]

- **[Decision]:** [Why it was made and what trade-off was accepted. E.g. "No ORM — raw SQL
  via postgres.js. Reason: full control over queries, no N+1 surprises. Trade-off: more
  verbose, must write migrations manually."]
- **[Decision]:** [Why. E.g. "Fastify over Express — measurably faster, better TypeScript
  types out of the box. Trade-off: smaller ecosystem, fewer Stack Overflow answers."]
- **[Decision]:** [Why.]

---

## Known issues / gotchas

[Things that will bite you if you don't know about them. Be specific.]

- **[Issue]:** [What it is and how to work around it. E.g. "Integration tests must run
  serially — `--runInBand`. Parallel runs cause port conflicts on the test DB."]
- **[Issue]:** [What. E.g. "The `/health` endpoint must return `{status: 'healthy'}` —
  the Railway health check in CI hard-codes this shape."]
- **[Issue]:** [What.]
