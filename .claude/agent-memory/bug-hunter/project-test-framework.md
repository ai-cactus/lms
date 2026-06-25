---
name: project-test-framework
description: Test framework, runner command, config, and mocking patterns used in this repo
metadata:
  type: project
---

**Test runner:** Vitest v4.1.8 (`npm test` → `vitest run`)
**Config:** `vitest.config.mts` at project root — jsdom environment, setup file `vitest.setup.ts`, alias `@` → `./src`.

**File placement conventions:**
- Action tests: `src/app/actions/<name>.test.ts` (co-located with the action)
- API route tests: `src/app/api/<path>/route.test.ts` (co-located with the route)
- Lib tests: `src/lib/<name>.test.ts`

**Mocking pattern (canonical):**
1. Use `vi.hoisted()` to construct mock objects/functions before `vi.mock()` factories run — required when mock refs are used inside factory bodies.
2. Declare all `vi.mock()` calls before any `import` of the module under test.
3. Import the module under test last.
4. Call `vi.clearAllMocks()` in `beforeEach`.

**Key mocks for auth/signup tests:**
- `next/headers` → `vi.mock('next/headers', () => ({ headers: mockHeadersFn }))` where `mockHeadersFn` returns a Headers-like `{ get: vi.fn() }`.
- `@/lib/prisma` → `vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }))`.
- `@/lib/rate-limit` → `vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockFn }))`.
- `@/lib/email` — dynamic import inside `signupWithRole`; mock path `@/lib/email` works because Vitest intercepts it at module resolution.
- `bcryptjs` — needs both `default` and named export: `{ default: { hash: vi.fn() }, hash: vi.fn() }`.

**High-risk modules warranting ongoing attention:**
- `src/app/actions/auth.ts` — signupWithRole: rate limiting, token expiry, email send.
- `src/app/api/auth/resend-verification/route.ts` — role preservation, rate limiting, expiry.
- `src/lib/rate-limit.ts` — Redis-backed with in-memory fallback; not directly unit-tested (integration concern).
