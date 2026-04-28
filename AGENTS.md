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
- **Logging**: Use the centralized logger in `src/lib/logger.ts`. ALWAYS use `logger.info`, `logger.error`, etc. instead of `console.log` or `console.error` for this codebase.
- **Naming**: Use descriptive names for components and utility functions.
- **Enforced Hooks**: Pre-commit hooks via Husky/lint-staged (ESLint + Prettier).

## Commit & Pull Request Guidelines
- **Branches**: Use `feature/` or `bugfix/` prefixes for all branches (e.g., `feature/ai-pipeline`).
- **Commits**: Follow `feat:`, `fix:`, `chore:` conventional commit prefixes where possible.
- **Workflow**: Create PRs against the `dev` branch for integration. PRs should be focused on single logical changes.
