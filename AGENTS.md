# Repository Guidelines

LMS is an AI-powered Learning Management System built with Next.js 16 (App Router) and PostgreSQL (Prisma). It transforms raw documents into interactive learning experiences using Google Vertex AI and Gemini.

## Project Structure & Module Organization
- **App Router**: Follows Next.js App Router conventions in `src/app/`.
- **AI Pipeline (v4.6)**: Multi-stage orchestration for content generation and PHI scanning.
- **Isolation**: Multi-tenant organization support and role-based access (`admin` vs `worker`).
- **Data Persistence**: Prisma ORM with PostgreSQL backend in `prisma/schema.prisma`.
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
- **UI & Styling**: Vanila CSS for responsive design.
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
| Event type | Level |
|---|---|
| Entity created / updated / deleted | `info` |
| Course published / attested / retake assigned | `info` |
| Document uploaded / renamed / deleted | `info` |
| Quiz submitted (with score + pass/fail) | `info` |
| Auth: login attempt, success, password reset | `info` |
| AI pipeline stage entry/exit | `info` |
| Rate limit exceeded, role mismatch, unauthorized | `warn` |
| External API error (Vertex AI, storage, email) | `error` |
| DB transaction failure | `error` |
| Background job failed / CRITICAL | `error` |

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
