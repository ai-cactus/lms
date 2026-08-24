# Contributing to LMS

Thank you for your interest in contributing to LMS! We welcome contributions from the community to help make this AI-powered learning management system even better.

## 🤝 Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. We expect all contributors to maintain a respectful and inclusive environment.

## 🛠 Development Workflow

1.  **Fork the Repository**: Create a personal fork on GitHub.
2.  **Clone Locally**: `git clone https://github.com/your-username/lms.git`
3.  **Create a Branch**: Use descriptive names like `feature/new-ai-pipeline` or `bugfix/auth-redirect`.
4.  **Install Dependencies**: `npm install`
5.  **Make Changes**: Ensure your code follows our style guidelines.
6.  **Run Linting**: `npm run lint`
7.  **Submit a Pull Request**: Provide a clear description of your changes and link any relevant issues.

### 🔁 Workflow Breakdown

1. **Pull latest dev**

```bash
git checkout dev
git pull origin dev
```

2. **Create feature branch**

```bash
git checkout -b feature/auth-refactor
```

3. **Make changes**

4. **Push branch**
```bash
git push origin feature/auth-refactor
```

5. **Create PR:**

- `Base branch → dev`

- `Compare branch → feature/auth-refactor`

6. **Get review → Merge into dev**

## ✅ Local Verification & CI Policy

Heavy verification runs **locally**, not in CI. GitHub Actions minutes are a hard
constraint, so CI keeps only what a local hook cannot honestly replace.

| Event                          | Runs online                                            | Runs locally                                                    |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| `git commit`                   | —                                                        | lint-staged (`src`, `scripts`, `tests`) + staged secret scan      |
| `git push feature/*`           | —                                                        | eslint + vitest on changed files, `tsc --noEmit` (~30–60s)        |
| `git push dev\|staging\|main`  | —                                                        | the above **+ full vitest suite + `next build`** (~5–7 min)       |
| PR → `dev`                     | Static Checks + Build Check (~5 min)                     | —                                                                 |
| PR → `staging` / `main`        | + full unit suite + **E2E** + Semgrep/Trivy (~22 min)    | `npm run e2e:local` on demand                                     |
| Weekly / on demand             | Semgrep, Trivy, gitleaks full history, SBOM              | —                                                                 |
| Daily                          | `npm audit` (high+) → auto-issue                         | —                                                                 |

**Never use `git push --no-verify`.** It skips everything. If a protected-branch push
is genuinely too slow right now, use `SKIP_HEAVY=1 git push` — the light checks still run.

### Commands

```bash
npm run verify        # light tier: changed-file lint + typecheck + affected tests
npm run verify:full   # heavy tier: lint + format + typecheck + full suite + build
npm run typecheck     # tsc --noEmit
npm run test:changed  # affected unit tests only (VERIFY_BASE=origin/main to retarget)
npm run secrets:scan  # staged-only gitleaks scan
```

### Running E2E locally

`npm run e2e:local` runs the Playwright suite in CI parity — production build,
one worker, real Postgres/Redis/MinIO/MailHog. Takes about 5 minutes.

```bash
npm run e2e:local                     # everything
npm run e2e:local -- auth.spec.ts     # one spec
E2E_SKIP_BUILD=1 npm run e2e:local    # reuse the existing build
E2E_RESET=1      npm run e2e:local    # drop + recreate the database
E2E_KEEP_UP=1    npm run e2e:local    # leave the containers running
npm run e2e:up / e2e:down             # manage the containers directly
```

The stack binds ports **5442 / 6389 / 9010 / 1125**, deliberately offset from
`docker-compose.dev.yml`, so the dev stack can stay up alongside it. Environment
values live in the committed `.env.e2e` (dummy values only) and are exported into
the process, which outranks — and never modifies — your `.env` / `.env.local`.

For fast single-spec iteration against a dev server, use `npm run test:e2e -- <spec>`.

### Getting E2E to run in CI for a `dev` PR

Add the **`run-e2e`** label to the PR, or trigger the CI workflow manually via
`workflow_dispatch`.

### Optional tooling

`gitleaks` is not an npm dependency. Without it the pre-commit secret scan skips
with a warning (CI still scans the full tree). Install it to catch leaks before
they leave your machine:

```bash
brew install gitleaks   # or: go install github.com/gitleaks/gitleaks/v8@latest
```

## 📜 Coding Standards

- **TypeScript**: Use strict typing where possible. Avoid `any`.
- **Next.js**: Follow App Router conventions.
- **Prisma**: Ensure all schema changes are backed by migrations or documented push steps.
- **Styling**: Use **Tailwind CSS v4 + shadcn/ui** components for all new pages, features, and UI. Do not add new CSS Modules (`.module.css`) or inline styles; use `lucide-react` for icons and the theme tokens in `src/app/globals.css`. Reuse the shared primitives in `src/components/ui/*`, keep every screen responsive, and follow `docs/ui-migration-pattern.md`.
- **Logging**: Use the centralized logger in `src/lib/logger.ts`.

## 🐛 Bug Reports & Feature Requests

- Use GitHub Issues to report bugs or suggest new features.
- Provide as much detail as possible, including steps to reproduce bugs or clear use cases for features.

## 🚀 Pull Request Process

1.  Keep PRs focused on a single change.
2.  Update documentation if your changes affect external behavior or setup.
3.  Wait for a maintainer to review and approve your PR.

---

_Questions? Reach out to the maintainers or open an issue._
