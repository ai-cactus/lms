# 02 — Frontend Specification (Retained Next.js)

**Service:** `web` (Next.js 16 App Router, React 19). **Prerequisite:** [`00-OVERVIEW.md`](./00-OVERVIEW.md), [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md). API contract: [`03-BACKEND-SPEC.md`](./03-BACKEND-SPEC.md).

The frontend **keeps its routes, components, and design system**. What changes is *where its data comes from*: today it reaches directly into the database, storage, queues, Stripe, email, and AI; after the split it talks only to the backend over HTTP. This document specifies that decoupling and what each area needs from the API.

## 1. What stays vs. what changes

**Stays (no change):** the entire route tree and route groups (public/marketing, `(auth)`, `dashboard/(main)`, `dashboard/(wizard)`, `worker`, `learn`, onboarding, `system`); the shadcn/ui primitives and Tailwind theme; the course player (`learn/[id]`), which *already* fetches everything via `/api/*` and only needs its base URL re-pointed; React Hook Form usage; the resumable direct-to-storage upload pattern.

**Changes (the decoupling work):**
1. **26 server-component pages that call Prisma directly** → fetch from `api` in the server component (server-side fetch with the forwarded session cookie).
2. **31 server-action modules used as RPC** → replaced by calls to an HTTP client layer (below). Server actions may remain as thin *proxies* that call `api` (keeps form-action ergonomics) or be removed in favor of client fetches — decide per form; either way they hold no business logic.
3. **Direct storage/queue/Stripe/email/AI access** → gone; all via `api`.
4. **NextAuth + `proxy.ts` local JWT decode** → session validated via `api` (§3).

*(This is the concrete work behind resolving F-007's app-layer coupling and moving PHI/secrets out of the browser tier — F-008.)*

## 2. Introduce an HTTP client layer (does not exist today)

The audit found **no client API abstraction** — raw `fetch` is scattered across 16+ files and most data comes through server actions. Create one typed client used by both server components and client components:

```
web/src/lib/api/
  client.ts        # base fetch wrapper: baseURL from env, credentials: 'include',
                   # forwards session cookie (server-side), attaches correlation id,
                   # maps the { error: { code, message } } envelope to typed errors,
                   # one retry policy, timeout
  endpoints/*.ts   # typed functions per module mirroring doc 03 (auth, courses, billing, ...)
  types.ts         # request/response types shared with the backend contract
```

- **Server components** call it with the incoming request's cookies forwarded (so `api` sees the session). Base URL = internal service DNS (`http://api:3000/api/v1` on the private network).
- **Client components** call it with `credentials: 'include'`; base URL = the public API origin (or a same-origin `/api` reverse-proxied to `api`, preferred so cookies stay first-party).
- Centralize loading/error handling here; add the missing `error.tsx` boundaries and `loading.tsx` skeletons while you're touching each area (F-064).

## 3. Session & auth (frontend side)

`api` owns tokens; `web` stops decoding JWTs locally (removing the `AUTH_SECRET`/`NEXTAUTH_SECRET` split-brain, F-035).

- **Middleware (`proxy.ts`):** instead of decoding the cookie, call `GET /auth/session` (cache per-request) to get `{ role, organizationId, passwordResetRequired, mfaEnabled, mfaVerified, ... }`, then apply the same gating it does today: realm↔route mapping, forced-reset redirect, MFA step-up redirect, worker-onboarding gating. Keep the two-realm cookie model (`admin.session-token` / `worker.session-token`).
- **Server components** that need the user call the same session endpoint (replacing the 53 `auth()` call sites).
- **Login/signup/MFA pages** post to `api` auth endpoints; the cookie is set by `api` (same-site) and read by both tiers.
- The frontend must preserve cookie names/flags so existing sessions and simultaneous admin+worker tabs keep working (doc 03 §3).

## 4. Per-area data requirements (what each area needs from `api`)

### Public / auth
- Certificate verification lookup (`GET /public/certificates/:code/verify` — name/course/org/date only, F-038); demo-request submit; enterprise inquiry; session bootstrap for login/signup/MFA/verify flows.

### Admin dashboard
- Dashboard stats + courses (paginated; backend uses `groupBy`/`_count`, not full enrollment loads — F-028); courses list/CRUD; the course **wizard** (category tree, document selection, `POST /generation-jobs` + poll, mapping, publish); documents list/detail + `documents/upload-url` + PHI-scan status; staff list/detail/invite/remove/manager; training list/detail/preview/results; compliance table; audit-reports + `reports/exports` (start/poll/download); billing overview/subscription/payment-methods/portal; profile/org settings; notifications.
- Media: `media/*` signed-URL endpoints for document/certificate/video preview (no byte proxy).
- Realtime: **one** job-polling hook (consolidate the two today — F-061) hitting `GET /jobs/:id` / `GET /generation-jobs/:id`.

### Worker / learn
- Worker dashboard/metrics, trainings, certificates, profile, notifications.
- **Course player** (heaviest consumer, already fetch-based): `GET /courses/:id/content`, `PATCH /enrollments/:id/progress`, quiz `attempts/start|current|submit`, `GET /media/video/:lessonId`. Keep the same response shapes so only the base URL changes.
- Worker onboarding: org-code join, profile completion, bulk staff import (decide: parse xlsx in `web` as today, or upload and parse in `worker` — recommended, to keep the ~1 MB `xlsx` lib and its CVEs off the client, F-011/F-063).

### System (super-admin)
- System users CRUD, manual upload+index, video-courses CRUD+upload+transcode, reminders trigger, worker/queue admin — via `admin/*` (separate system-admin auth).

## 5. Frontend-local improvements to fold in (from the analysis)

While decoupling each area, resolve the frontend findings:
- **F-062** — move `<Toaster>` from the admin layout to the root providers so toasts work in worker/auth/onboarding/system.
- **F-061** — delete the ad-hoc `ExportJobsProvider` poller; use the shared `use-job-status` hook against `GET /jobs/:id`.
- **F-063** — `next/dynamic` for recharts and react-pdf; parse spreadsheets server-side (or dynamic-import xlsx); reduce unnecessary client components.
- **F-064** — add `error.tsx` boundaries and route `loading.tsx` skeletons.
- **F-065** — adopt theme tokens over the 78 raw-hex `className` files and 26 inline-style files; collapse the two token sources (`globals.css` `@theme` vs `src/style/design-tokens.ts`) to one.

## 6. Environment (frontend)

The `web` tier holds **only** public config and its API base URL — never a secret, never `NEXT_PUBLIC_GEMINI_API_KEY` (F-008):
- `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_BASE_URL` (public origin), `API_INTERNAL_URL` (private DNS for SSR fetches), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES`.
- Session cookie signing/verification stays in `api`; `web` never needs the auth secret.

## 7. Migration ergonomics

Because the frontend keeps its structure, the split can be done **area by area** (doc 08): stand up `api`, then move one route group at a time from direct-Prisma/actions to the HTTP client, verifying each against the same UI. The course player and billing tabs (already fetch-based) are the easiest first cutovers; the direct-Prisma dashboard pages are the most work.
