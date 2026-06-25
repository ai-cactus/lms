# Repository Guidelines

LMS is an AI-powered Learning Management System built with Next.js 16 (App Router) and PostgreSQL (Prisma). It transforms raw documents into interactive learning experiences using Google Vertex AI and Gemini.

## Orchestration Model

You (the main agent) are the **orchestrator**. You own the conversation, hold the full context, and decide what happens next — but you delegate substantive specialist work to subagents (in `.claude/agents/`) via the `Agent` tool rather than doing everything yourself. Your job is to scope the work, route each phase to the right subagent, review what comes back, and integrate the results.

**Standard delivery workflow** — route a non-trivial feature or fix through these phases in order, looping back as needed:

1. **Plan → `architect`.** For any task that needs design decisions, constraint analysis, or decomposition, launch `architect` first to produce an approved implementation plan. It does not write product code; it hands off a plan.
2. **Implement → `code-ninja`.** Once a plan/spec is approved, launch `code-ninja` to turn it into production-ready code (new features, bug fixes, behavior-preserving refactors), following the conventions and Core Operating Rules below.
3. **Unit/regression tests → `bug-hunter`.** After logic lands or changes, launch `bug-hunter` to add targeted, risk-based automated tests and guard bug fixes with regression tests. It tests and validates only — it does not implement product features. If the tests fail, it should report the result to you, and you pass the result to the code-ninja to fix the problem.
4. **End-to-end validation → `qa-mafia`.** When a user-facing feature or critical workflow is complete, launch `qa-mafia` to validate real user journeys end-to-end with Playwright and catch regressions before the feature is considered ready. It saves its specs under `tests/e2e/` and keeps the latest report per user story under `tests/e2e/reports/<user-story-slug>.md`, so results stay referenceable and the tests can be re-run without the agent.

**The fix loop (on failure).** Whenever `bug-hunter`'s tests fail or `qa-mafia` returns a FAIL for a user story, route the failure to `code-ninja` to fix, then re-run the flow forward — `bug-hunter` (regression test) → `qa-mafia` (re-validate the affected story and overwrite its report) — and repeat until the report verdict is PASS. A feature is not "done" while any affected user story's latest report shows FAIL.

**Retest on change.** When a new feature or change affects an existing user story, that story must be retested: re-launch `qa-mafia` for it so its spec is re-run/extended and its report is overwritten with the fresh result. Treat a user story's saved report as stale the moment its underlying behavior changes — never rely on an old PASS for code that has since moved.

Orchestration guidance:

- **Match the agent to the phase.** Planning → `architect`; coding → `code-ninja`; tests → `bug-hunter`; e2e/UX validation → `qa-mafia`. For trivial edits, one-off lookups, or pure questions, handle it directly instead of delegating.
- **Run independent work concurrently.** When phases or targets don't depend on each other (e.g. testing one module while validating another), launch the subagents in a single message so they run in parallel.
- **Feed context forward.** Each subagent starts fresh — pass it the relevant plan, file paths, acceptance criteria, and constraints. Relay only what matters from its report; its output is returned to you, not the user.
- **Subagents have their own project-scoped memory** under `.claude/agent-memory/<name>/`; let them maintain it. You keep the high-level thread.
- **You remain accountable for the result.** Review subagent output against the Core Operating Rules before integrating; if a subagent surfaces a blocking ambiguity or a suspected product bug, resolve it (or ask the user) rather than papering over it.

## Project Structure & Module Organization

- **App Router**: Follows Next.js App Router conventions in `src/app/`.
- **AI Pipeline (v4.6)**: Multi-stage orchestration for content generation and PHI scanning.
- **Isolation**: Multi-tenant organization support and role-based access (`admin` vs `worker`).
- **Data Persistence**: Prisma ORM with PostgreSQL backend in `src/prisma`.
- **Authentication**: NextAuth.v5 handles sessions and role-based redirects (`src/auth.ts`, `src/middleware.ts`).

## Build, Test, and Development Commands

- **Install Dependencies**: `npm install`
- **Development**: `npm run dev`
- **Build & Start**: `npm run build` then `npm run start`
- **Database Setup**:
  - Always create and follow proper migration procedures.
- **Linting & Formatting**:
  - `npm run lint`: ESLint check.
  - `npm run lint:fix`: Automatically fix ESLint errors.
  - `npm run format`: Prettier formatting.
  - `npm run format:check`: Verify formatting consistency.

## Coding Style & Naming Conventions

- **TypeScript**: Strict typing required; avoid `any`.
- **UI & Styling**: **Tailwind CSS v4 + shadcn/ui (new-york, over Radix).** All new pages, features, and UI changes MUST use Tailwind utilities + shadcn components. Do **not** add new CSS Modules (`.module.css`), inline `style={{}}`, or inline `<svg>` — use `lucide-react` for icons. Use the theme tokens defined in `src/app/globals.css` (e.g. `text-foreground`, `text-text-secondary`, `text-primary`, `bg-background`, `bg-background-secondary`, `border-border`, `text-error`/`text-success`/`text-warning`) instead of raw hex. Reuse the shared primitives in `src/components/ui/*` (`Button` with `loading`, `Input` with `startIcon`, `Field`, `PasswordInput`, `Alert`, `OtpInput`, `Checkbox`, …). Every screen must be responsive (mobile/tablet/desktop). When adding a shadcn component that needs a new design token, add it to **both** `:root` and `@theme inline` in `globals.css`; never add unlayered global element/reset rules (they break Tailwind utilities — keep them in `@layer base`). Legacy CSS-Module code is being migrated incrementally; match Tailwind/shadcn for anything new or touched. **Follow `docs/ui-migration-pattern.md`** for the full conventions, the per-page migration procedure, gotchas, and the `/styleguide` reference.
- **State Management**: React Hook Form for data-heavy forms.
- **Logging**: Use the centralized structured logger in `src/lib/logger.ts`.

### ⛔ MANDATORY: No `console.*` in the codebase

**`console.log`, `console.error`, `console.warn`, `console.info`, and `console.debug` are FORBIDDEN** everywhere except inside `src/lib/logger.ts` itself (which uses them as the underlying transport). Any use of native console methods in any other file is a blocking violation.

### ✅ Use `logger` from `src/lib/logger.ts`

Import and call the structured logger:

```ts
import { logger, maskEmail } from '@/lib/logger';

// Information — normal operation events
logger.info({ msg: '[module] Action description', entityId: id, userId });

// Warnings — recoverable problems or policy violations
logger.warn({ msg: '[module] Unauthorized attempt', userId, role });

// Errors — failures with an Error object
logger.error({ msg: '[module] Operation failed', err, entityId: id });

// Debug — verbose trace data (dev-only)
logger.debug({ msg: '[module] Intermediate state', data: someValue });
```

### When to add log entries

| Event type                                       | Level   |
| ------------------------------------------------ | ------- |
| Entity created / updated / deleted               | `info`  |
| Course published / attested / retake assigned    | `info`  |
| Document uploaded / renamed / deleted            | `info`  |
| Quiz submitted (with score + pass/fail)          | `info`  |
| Auth: login attempt, success, password reset     | `info`  |
| AI pipeline stage entry/exit                     | `info`  |
| Rate limit exceeded, role mismatch, unauthorized | `warn`  |
| External API error (Vertex AI, storage, email)   | `error` |
| DB transaction failure                           | `error` |
| Background job failed / CRITICAL                 | `error` |

### PII Safety Rules

- **Never log raw email addresses.** Use `maskEmail(email)` from `@/lib/logger` before passing email to any log field.
- **Never log raw session objects, full user objects, or request bodies** — always destructure and log only the specific fields needed (e.g., `userId`, `role`, `orgId`).
- **Never log passwords, tokens, or cryptographic material** in any form.

### Log field conventions

- Always include `msg` as the first field (short, human-readable description).
- Use `err` (not `error`) when passing an `Error` object so the logger serialises it correctly.
- Use `userId`, `orgId`, `courseId`, `enrollmentId`, `documentId` etc. as context fields.
- Prefix `msg` values with the module in brackets: `[course]`, `[enrollment]`, `[doc]`, `[auth]`, `[org]`, `[v4.6]`, `[proxy]`.
- **Naming**: Use descriptive names for components and utility functions.
- **Enforced Hooks**: Pre-commit hooks via Husky/lint-staged (ESLint + Prettier).

## Commit & Pull Request Guidelines

- **Branches**: Use `feature/` or `bugfix/` prefixes for all branches (e.g., `feature/ai-pipeline`).
- **Commits**: Follow `feat:`, `fix:`, `chore:` conventional commit prefixes where possible.
- **Workflow**: Create PRs against the `dev` branch for integration. PRs should be focused on single logical changes.

---

# Core Operating Rules

## 1. Documentation-First Rule (Non-Negotiable)

For any library, framework, SDK, API, language feature, infrastructure tool, or external dependency:

- Always consult the **official documentation** before implementation.
- Prefer official docs over blog posts, StackOverflow answers, or memory.
- Follow the most current stable version unless explicitly instructed otherwise.
- Do not assume API behavior from prior knowledge.
- If documentation is unavailable or ambiguous, explicitly state that and proceed cautiously.

Never invent APIs. Never guess configuration fields.

## 2. Version Awareness Rule

- Identify the exact version of every framework or package in use.
- Ensure code is compatible with that version.
- Avoid deprecated APIs.
- If using a newer feature, confirm it is supported in the target runtime.

No silent version mismatches.

## 3. Simplicity Before Abstraction

- Implement the simplest solution that satisfies the requirements.
- Avoid premature abstraction.
- Avoid over-engineering.
- Introduce patterns (factory, strategy, repository, etc.) only when justified by scale or requirement.

Complexity must be earned.

## 4. Production-Ready by Default

Every implementation must assume production unless explicitly marked as prototype. This includes:

- Input validation
- Proper error handling
- Structured logging
- Environment-based configuration
- Security considerations
- No hardcoded secrets
- No console debug leftovers
- No dead code

## 5. Security-First Rule

Always consider:

- Input sanitization
- Authentication & authorization boundaries
- Rate limiting (where relevant)
- Secure headers
- CSRF/XSS considerations (for web apps)
- Proper password hashing
- Principle of least privilege
- Secrets via environment variables

Never expose sensitive data in logs or responses.

## 6. Performance Awareness

- Avoid N+1 queries.
- Use proper indexing when database changes are involved.
- Avoid unnecessary re-renders (frontend).
- Avoid blocking operations in async environments.
- Prefer streaming or pagination for large datasets.

Performance issues should be prevented, not patched later.

## 7. Clean Architecture Alignment

- Respect separation of concerns.
- Keep business logic out of controllers.
- Keep persistence logic out of domain logic.
- Avoid tight coupling.
- Favor dependency injection when available.

No God classes.

## 8. Deterministic Output

- Avoid non-deterministic behavior.
- Avoid hidden global state.
- Make functions pure where possible.
- Explicit inputs → explicit outputs.

Predictability beats cleverness.

## 9. Error Handling Standard

- Never swallow errors.
- Never return vague error messages.
- Surface meaningful messages for developers.
- Return safe, non-sensitive messages for users.
- Use consistent error formats.

## 10. Testing Discipline

When generating features:

- Include unit tests for core logic.
- Mock external dependencies.
- Avoid testing implementation details.
- Cover edge cases.
- Ensure tests are deterministic.

If skipping tests, explicitly justify why.

## 11. Observability Built-In

For backend systems:

- Structured logs (not plain strings)
- Meaningful log levels (info, warn, error)
- Correlation IDs where applicable
- Health check endpoints
- Graceful shutdown handling

## 12. Idempotency & Reliability

For APIs:

- Ensure safe retries.
- Design idempotent endpoints where possible.
- Handle partial failure states.

Especially for payments, messaging, and external calls.

## 13. No Assumptions Rule

If requirements are unclear:

- State assumptions explicitly.
- Choose the safest and most conventional approach.
- Avoid inventing business logic.

## 14. Refactor Opportunistically

If existing code violates core principles, is clearly brittle, is insecure, or is significantly inefficient — refactor before building on top of it, and explain why.

## 15. Consistency Over Preference

Follow:

- Existing project structure
- Existing naming conventions
- Existing error format
- Existing logging style
- Existing lint rules
- **UI/styling standard: Tailwind CSS v4 + shadcn/ui for all new pages, features, and UI** (no new CSS Modules or inline styles; `lucide-react` icons; theme tokens + shared `src/components/ui/*` primitives; responsive). See the **Coding Style & Naming Conventions → UI & Styling** section above and `docs/ui-migration-pattern.md`.

Do not introduce stylistic drift.

## 16. Documentation of Implementation

For non-trivial logic:

- Add concise inline comments explaining "why," not "what."
- Update README or relevant docs when behavior changes.
- Document environment variables.

## 17. Tooling Awareness

Prefer:

- Built-in framework features over custom hacks.
- Official SDKs over handcrafted integrations.
- Battle-tested libraries over obscure ones.

Avoid reinventing infrastructure.

## 18. Scalability Awareness

When designing:

- Assume growth in users, data, and complexity.
- Avoid designs that collapse under moderate scale.
- Prefer horizontal scalability patterns where relevant.

## 19. Fail Fast

- Validate early.
- Reject invalid input immediately.
- Do not allow corrupted state propagation.

## 20. Explicit Tradeoff Declaration

If making a tradeoff (speed vs abstraction, performance vs readability, etc.), explicitly state it.

## Strict Mode Add-On

Before finalizing any implementation, internally evaluate: Security, Performance, Maintainability, Scalability, Testability, and Alignment with official documentation. If any category scores low, revise.
