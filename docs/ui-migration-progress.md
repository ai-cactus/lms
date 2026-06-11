# UI Migration Progress Tracker

Living status of the Tailwind v4 + shadcn UI migration. **Update this file whenever a slice/page is migrated** — it is the single source of truth for "what's done" across sessions (we ship features between migration passes, so don't rely on memory).

**Last updated:** 2026-06-11 (dashboard: shell, home, Courses list, Documents list, Staff Profile, Staff list, Training pages)
**Branch convention:** one `feature/<slice>-ui-migration` branch per slice, PR'd against `dev`.
**Companion docs:** conventions → [`ui-migration-pattern.md`](./ui-migration-pattern.md) · auth spec → [`superpowers/specs/2026-06-10-auth-ui-migration-design.md`](./superpowers/specs/2026-06-10-auth-ui-migration-design.md)

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## Foundation — ✅ done

- ✅ shadcn semantic tokens defined in `globals.css` (`:root` + `@theme inline`)
- ✅ Base/reset rules moved into `@layer base` (so Tailwind utilities aren't overridden)
- ✅ Control sizing matched to Figma (Button 44/48px, Input 56px, radius 10px, 20px icons, Logo md 32px)
- ✅ Button states: grey-disabled (requirements unmet) vs colour-while-loading (`aria-busy`); secondary hover-fill
- ✅ Test infra: vitest + jsdom + React Testing Library
- ✅ Repo instructions mandate Tailwind/shadcn (`AGENTS.md`, `CONTRIBUTING.md`)

### Shared primitives (in `src/components/ui/`, unit-tested, shown on `/styleguide`)
`Button` (loading) · `Input` (startIcon) · `PasswordInput` · `Field` · `Alert` · `OtpInput` · `Checkbox` · `RowActionsMenu` (kebab) · `Table` · `AuthShell` (`src/components/auth/`)
Still **legacy** (in `ui/legacy/`, used by unmigrated slices): `Button`, `Input`, `Checkbox`, `Select`, `Modal`. Flip the barrel per-component when its last consumer is gone.

---

## Slices

### Auth — ✅ done (slice 1, the reference implementation)
All pages on Tailwind/shadcn; CSS Modules deleted; behavior preserved vs `dev`; verified at 375/768/1440.
- ✅ `(auth)/login` · `(auth)/signup` · `(auth)/signup/role-selection`
- ✅ `(auth)/forgot-password` · `(auth)/reset-password`
- ✅ `(auth)/verify-email` · `(auth)/verify`
- ✅ `(auth)/mfa/verify` · `(auth)/mfa/recover` · `verify-2fa`
- ✅ `join/[token]` · `components/auth/AuthHeroSlider` · `AuthShell`
- ✅ `/styleguide` (component showcase)

### Dashboard (admin) — 🚧 in progress
Biggest slice: ~16 page routes + ~50 components. Sub-order:
- ✅ **Shell** — `DashboardLayoutClient` (sidebar + mobile drawer), `Header` (notifications + profile dropdown + logout via shadcn Dialog), `DashboardEmptyState`. lucide icons, responsive drawer verified at 375/768/1440. NOTE: `layout.module.css` + `Header.module.css` intentionally **kept** (still imported by the worker shell — delete in the Worker slice).
- ✅ **Home/overview** — `dashboard/(main)/page` (header + tinted metric cards) + `DashboardCharts` (bar + recharts donut) + `DashboardCreateCourseButton`. `page.module.css` deleted. Verified at desktop/mobile. (`MyCoursesTable` on the home still on its own module — part of the Tables pass.)
- 🚧 Courses: ✅ **Courses list** (`CoursesListClient` — table + `RowActionsMenu` kebab [Rename/Delete] + View link, search, pagination w/ shadcn Select, billing gate, pending-gen banner, rename modal, delete; responsive column-hiding; `CoursesList.module.css` deleted; all functionality preserved). ⬜ `(wizard)/courses/create`, `courses/queue`, `courses/[id]/mapping`, `components/courses/*`
- 🚧 Documents: ✅ **Documents list** (`page.tsx` header + `upload-section` + `DocumentListClient` — file-type icons, status pills [Completed/In Progress/Not Started], `RowActionsMenu` kebab [View/Edit Name/Delete, Delete disabled when course-linked], search, pagination, rename modal; responsive column-hiding; all functionality preserved). NOTE: `documents/page.module.css` **kept** (still imported by `[id]/page.tsx` detail + `upload-modal`). ⬜ `(main)/documents/[id]` detail.
- 🚧 **Tables** — ✅ `MyCoursesTable` (home display table: shadcn `Table` + View Course links, responsive scroll, module deleted). ✅ New reusable **`RowActionsMenu`** kebab (`src/components/ui/RowActionsMenu.tsx`, lucide `MoreVertical` + themed dropdown, on `/styleguide`) — list ports below should use it instead of inline kebabs.
- ✅ Staff: ✅ **Staff Profile** (`StaffProfileClient` `/staff/[id]` — avatar header + 4 action buttons, 4 tinted stat cards, Courses/Certificates tabs, courses table with progress bars + multi-state quiz badges + Retake/View, quiz-result overlay, 4 modals; `StaffProfile.module.css` deleted). ✅ **Staff list** (`StaffListClient` — avatars w/ status dot + Pending badge, plan-seat badge, conditional `RowActionsMenu` kebab [pending: Revoke; active: View Profile/Export PDF/Remove], search, pagination, 5 modals; all logic preserved). NOTE: `StaffList.module.css` **kept** (still imported by `RemoveStaffModal`). Minor: staff-profile mobile action buttons get tight (table scrolls) — polish later.
- 🚧 Training: ✅ **`TrainingDashboard`** (`/training` — stats cards + bar chart + custom donut + responsive My Courses table; module deleted) + ✅ **`TrainingDetails`** (`/training/courses/[id]` — breadcrumb/header/badges, 4 stat cards, Enrolled-Staff + Certificates tabs, status badges, `RowActionsMenu` kebab [View Result/Assign Retake], 3 modals; module deleted; all logic preserved). ⬜ `training/courses/[id]/preview` + `/results/[enrollmentId]`, other `components/dashboard/training/*`.
- ⬜ Billing: `(main)/billing` + `components/billing/*` (5 files)
- ⬜ Profile/settings: `(main)/profile`, `ProfileForm`, `ChangePasswordTab`, `TwoFactorAuthTab`, `components/auth/MfaSettings` (legacy Button)
- ⬜ Auditor pack: `(main)/auditor-pack` + `components/dashboard/auditor/*`

### Worker / Learn — ⬜ not started
`worker/*` (2/6 pages on modules), `learn/*` (1/1), `components/worker/*` (8/8 on modules), `components/learner/*`.

### Onboarding — ⬜ not started
`onboarding/*` (6/8), `onboarding-worker/*` (1/2), `components/onboarding/*` (1/1).

### System — ⬜ not started
`system/*` (2/4), `components/system/*` (4/4).

### Marketing / misc — ⬜ not started
`request-demo` (1/1), `privacy`/`terms` (check), `profile` top-level (0/1 — verify).

---

## Overall module.css burn-down
- **Start of migration:** 81 `.module.css` files.
- **As of last update:** 64 remaining (auth −10; dashboard shell −1; dashboard home −1; the two shared shell modules deferred to the Worker slice). Run to refresh:
  ```bash
  find src -name "*.module.css" | wc -l
  ```

## Known follow-ups / debt
- ⬜ `components/auth/MfaSettings.tsx` still imports legacy `Button` (migrate with the profile/settings area).
- ⬜ Visual-regression snapshots (Playwright) deferred from auth — add once a slice stabilizes.
- ✅ Login no longer enforces `PASSWORD_MIN_LENGTH` (fixed; existing short-password users can log in).
- ⬜ Pre-existing: login uses a permissive email regex (`/\S+@\S+\.\S+/`) — matches signup; revisit if stricter validation is wanted.

## Decisions log
- **2026-06-10** Strategy = extract-as-you-go + documented convention (Approach C). Fidelity = "Figma as direction + judgment". Verification = user-run + Playwright screenshots.
- **2026-06-10** Two systemic `globals.css` fixes (shadcn tokens + `@layer base`) — see [[project-tailwind-shadcn-foundation]] / `ui-migration-pattern.md` §0.
- **2026-06-11** Control sizes from the login Figma adopted as **global** defaults. Use `size="sm"` for dense/table contexts.
- **2026-06-11** Primary CTAs are **gated on form-completeness** (grey until required fields filled, purple when ready); loading keeps brand colour.

## How to resume / verify
- Dev server: `npm run dev` (port 3005). Screenshot any route at 3 breakpoints: `node scripts/shot.mjs <route>`.
- Gates before handing a page off: `npm run lint && npx tsc --noEmit && npm test`; production build `npm run build`.
- Per-page procedure + gotchas: `docs/ui-migration-pattern.md`.
- Figma: file key `cySAabdYLDKzwbs88owBHn` (THERAPTLY); token in `.env` (`FIGMA_ACCESS_TOKEN`). Ask the user for the specific frame/node link when a layout is unclear.
