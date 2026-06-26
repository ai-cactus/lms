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
- Component/page tests: co-located with the component, e.g. `src/app/(auth)/login/page.test.tsx`

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

**Component/page test mocking (from login page test):**
- `next/navigation` → `vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => ({ get: vi.fn().mockReturnValue(null) }) }))`.
- `next/image` → `vi.mock('next/image', () => ({ default: ({ alt }) => <img alt={alt} /> }))` — doesn't work in jsdom.
- `next-auth/react` → `vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))`.
- `@/components/auth/AuthHeroSlider` → stub to null (framer-motion + real images crash jsdom).
- `useActionState` (React 19): works natively in jsdom — mock the action function (`authenticate`) and the hook calls it as a regular async fn; wrap state-driven assertions in `waitFor`.
- Button ambiguity: if a page has multiple buttons where `/name/i` matches several (e.g. "Log in" and "Log In with Microsoft"), use anchored regex `/^exact name$/i`.

**High-risk modules warranting ongoing attention:**
- `src/app/actions/auth.ts` — signupWithRole: rate limiting, token expiry, email send.
- `src/app/api/auth/resend-verification/route.ts` — role preservation, rate limiting, expiry.
- `src/lib/rate-limit.ts` — Redis-backed with in-memory fallback; not directly unit-tested (integration concern).
- `src/app/(auth)/login/page.tsx` — credential-leak regression guard in `page.test.tsx`; must never log raw password or raw email at any log level.
- `src/lib/storage/gcs-provider.ts` — auth-selection constructor; tested in `src/lib/storage/gcs-provider.test.ts`.

**Storage module singleton pattern:**
- `src/lib/storage/index.ts` has module-level `_gcsInitialised` and `_minio` singletons. Tests that exercise different init paths must call `vi.resetModules()` + use dynamic `import()` inside the test/beforeEach to get a fresh module evaluation. See integration test in `gcs-provider.test.ts`.
