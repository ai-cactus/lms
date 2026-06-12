# UI Migration Progress Tracker

Living status of the Tailwind v4 + shadcn UI migration. **Update this file whenever a slice/page is migrated** — it is the single source of truth for "what's done" across sessions (we ship features between migration passes, so don't rely on memory).

**Last updated:** 2026-06-11 (dashboard course/training slice ✅ COMPLETE: **Documents**, **Training** (all modals/views + onboarding), **Courses** (list + wizard subsystem + player subsystem + queue + mapping + all course modals). 64→44 modules; all course-related modules eliminated. Remaining: billing, profile/settings, auditor-pack, worker/learn, onboarding, system, marketing.)
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
- ✅ Courses — **complete** (list, wizard subsystem, player subsystem, queue, mapping, all course modals): ✅ **Courses list** (`CoursesListClient` — table + `RowActionsMenu` kebab [Rename/Delete] + View link, search, pagination w/ shadcn Select, billing gate, pending-gen banner, rename modal, delete; responsive column-hiding; `CoursesList.module.css` deleted; all functionality preserved). ✅ **`courses/queue`** page (job-status list; `queue.module.css` deleted). ✅ **`courses/[id]/mapping`** page + `mapping-card` (two-panel mapping view; `mapping.module.css` deleted). ✅ **`AssignUserCourseModal`** (staff; Dialog + email chips + course Select; gating preserved; module deleted). ✅ **`ConfirmPublishModal`** (Confirm Course Review; Dialog + reviewer Input + confirm-checkbox gate + preventClose-while-publishing; module deleted). ✅ **`CourseSuccessModal`** (Dialog success; module deleted). ✅ **CourseWizard subsystem** — shared `CourseWizard.module.css` (2997 lines) + `Step1Category.module.css` migrated across all consumers and **deleted**: `CourseWizard` shell (step indicator/progress/nav/layout; dynamic progress-bar width kept), `Step1Category` (own module deleted), `Step2Documents` (upload + Sparkles/Folder/FileText lucide; selection-checkbox gate preserved), `Step3Details`, `Step4Quiz` (shadcn `Select` for difficulty; quality-notice warning card; pass-mark/attempts gates), `Step5Review` (wizard classes — its CoursePlayer classes already done), `Step6QuizReview`, `Step7Publish` (staff chip-search; renders the migrated publish/success/share modals), and `AdminQuizEditor` (reused the wizard stylesheet). All on shadcn `Button` (`variant="primary"`→`default`). Verified Step3/Step4 via `/xpreview` screenshots (consistent shared `stepTitle`/`stepWrapper`/form chrome across independently-migrated steps); shell + remaining steps via lint+tsc (auth/stateful flow, not mock-screenshotted). NOTE: 3 decorative composed `<svg>` illustrations intentionally kept (CourseWizard PHI-privacy document+magnifier illustration ×2; Step2 scanning circled-X) — no 1:1 lucide equivalent. ✅ **CoursePlayer subsystem** — shared `CoursePlayer.module.css` (1977 lines) migrated across all 6 consumers and **deleted**: `CourseArticle` (prose via arbitrary descendant variants `[&_h2]`/`[&_p]`…), `CourseSlide` (rich-slide injected HTML via `[&_.slide-*]` variants), `CourseRail` (done/active/unlocked/locked thumb states; mobile overlay→md:static), `AdminLessonEditor` (Quill `[&_.ql-*]` variants), `Step5Review` (CoursePlayer classes only — its `CourseWizard.module.css` import intentionally kept for the wizard slice), and `learn/[id]/page.tsx` (992-line player; media queries→`max-md:`/`max-[480px]:`, keyframes→`tw-animate-css`). `variant="primary"`→`default` on shadcn buttons. Verified `CourseArticle`/`CourseSlide`/`CourseRail` via `/xpreview` screenshots; `learn/[id]` accepted via lint+tsc+agent translation (auth+data-gated, not mock-screenshotted).
- ✅ Documents: ✅ **Documents list** (`page.tsx` header + `upload-section` + `DocumentListClient` — file-type icons, status pills [Completed/In Progress/Not Started], `RowActionsMenu` kebab [View/Edit Name/Delete, Delete disabled when course-linked], search, pagination, rename modal; responsive column-hiding; all functionality preserved). ✅ **Documents detail** (`(main)/documents/[id]/page.tsx` — back link + version badge + meta row + sidebar/main grid [stacks on mobile] + `PdfViewer`; `[id]/page.module.css` deleted). ✅ **Upload modal** (`upload-modal.tsx` → shadcn `Dialog` + `Checkbox` + `Alert`; PHI-agreement gate preserved via controlled state on the submit button; `modal.module.css` deleted). ✅ **`PdfViewer`** (shadcn `Button` toolbar; `PdfViewer.module.css` deleted). NOTE: the big orphaned `documents/page.module.css` (no remaining importer) **deleted**.
- 🚧 **Tables** — ✅ `MyCoursesTable` (home display table: shadcn `Table` + View Course links, responsive scroll, module deleted). ✅ New reusable **`RowActionsMenu`** kebab (`src/components/ui/RowActionsMenu.tsx`, lucide `MoreVertical` + themed dropdown, on `/styleguide`) — list ports below should use it instead of inline kebabs.
- ✅ Staff: ✅ **Staff Profile** (`StaffProfileClient` `/staff/[id]` — avatar header + 4 action buttons, 4 tinted stat cards, Courses/Certificates tabs, courses table with progress bars + multi-state quiz badges + Retake/View, quiz-result overlay, 4 modals; `StaffProfile.module.css` deleted). ✅ **Staff list** (`StaffListClient` — avatars w/ status dot + Pending badge, plan-seat badge, conditional `RowActionsMenu` kebab [pending: Revoke; active: View Profile/Export PDF/Remove], search, pagination, 5 modals; all logic preserved). NOTE: `StaffList.module.css` **kept** (still imported by `RemoveStaffModal`). Minor: staff-profile mobile action buttons get tight (table scrolls) — polish later.
- ✅ Training — **complete**: ✅ **`TrainingDashboard`** (stats cards + bar chart + custom donut + responsive My Courses table) + ✅ **`TrainingDetails`** (breadcrumb/header/badges, 4 stat cards, Enrolled-Staff + Certificates tabs, `RowActionsMenu` kebab, 3 modals). ✅ **`TrainingClient`** onboarding/empty-state card (mint-green hero + steps; `(main)/training/page.module.css` deleted). ✅ Sub-pages `training/courses/[id]/preview` (renders migrated `CoursePreview`) + `/results/[enrollmentId]` (inline error/empty divs → Tailwind). ✅ **All `components/dashboard/training/*` modals/views migrated** (each `.module.css` deleted): `CoursePreview` (dark hero + About tab + ToC sidebar), `QuizResults` (CircularProgress gauge + per-question correct/incorrect coding via success/error tokens), `ShareCourseModal` (Dialog; CSV/email assign; gating preserved), `AttestationModal` (Dialog; signature + 2 checkbox gate preserved), `CertificateModal` (Dialog; certificate card), `CertificateCardList`, `BadgeSuccessModal` (Dialog), `AssignRetakeModal` (was inline-styled + hand-rolled overlay → Dialog). All modals standardized on shadcn `Dialog` per pattern §3b. Verified via temp `/xpreview/[c]` route (course/quiz/attest/share/onboard/certs) + screenshots at desktop.
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
- **2026-06-11 (course/training slice):** 64 → **44 remaining** (−20 this pass: documents detail/upload/PdfViewer −4 [incl. orphaned parent]; all training modals/views + onboarding −8; queue/mapping/AssignUserCourseModal/ConfirmPublishModal/CourseSuccessModal −6; CoursePlayer shared −1; CourseWizard + Step1Category shared −2 — note some passes deleted 1 shared module covering many files). **All course-related modules eliminated.** Remaining 44 are worker/learn-shell, onboarding, system, billing, profile, auditor slices + intentionally-kept `StaffList.module.css` (RemoveStaffModal) and the two shell modules (worker slice). Gates green: `npm run lint` + `tsc --noEmit` + `npm test` (88/88).
- **Earlier:** 64 remaining (auth −10; dashboard shell −1; dashboard home −1; the two shared shell modules deferred to the Worker slice). Run to refresh:
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
