# UI Migration Progress Tracker

Living status of the Tailwind v4 + shadcn UI migration. **Update this file whenever a slice/page is migrated** — it is the single source of truth for "what's done" across sessions (we ship features between migration passes, so don't rely on memory).

**Last updated:** 2026-06-14 — 🎉 **MIGRATION COMPLETE. 0 `.module.css` files remain in `src/`.** All remaining slices migrated in one pass (billing, auditor-pack, profile/settings, worker/learn, onboarding, system, marketing/landing, staff modals, shared primitives, styleguide). Legacy components (`Button`/`Input`/`Modal`/`Select`/`Checkbox` + their modules) **deleted** from `src/components/ui/legacy/`; barrel exports removed. Only `legacy/ModalContext.tsx` (priority-based modal-coordination context — functional, not styling) is intentionally kept. Gates green: `tsc --noEmit` ✓, `eslint` ✓, `npm run build` ✓, `npm test` 158/158 ✓. Public routes verified rendering (0 console/page errors) at 375/desktop via Playwright. Auth-gated routes verified via the production build + tsc/lint (not screenshot — require login).

_Prior — 2026-06-11 (dashboard course/training slice ✅: Documents, Training, Courses)._
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
- ✅ Billing: `components/billing/*` (BillingPage/Overview/Subscription/PaymentMethod/BillingHistory) + `BillingGateModal` — tables→shadcn `Table`, modals→`Dialog`; `billing.module.css` + `BillingGateModal.module.css` deleted.
- ✅ Profile/settings: `ProfileForm`, `OrganizationForm` (shadcn `Select` family + `Checkbox`), `ChangePasswordTab`, `TwoFactorAuthTab`, `MfaSettings`, `profile/loading` — `ProfileForm.module.css` + `profile/loading.module.css` deleted.
- ✅ Auditor pack: `auditor-pack/page` + `components/dashboard/auditor/*` (Overview/Courses/Staff/Export tabs) — `auditor-pack.module.css` deleted.

### Worker / Learn — ✅ done
`components/worker/*` (WorkerHeader/DashboardLayout/ProfileForm/EmptyState/Dashboard/Profile/Achievements/CourseList/DashboardMetrics/TrainingList) + `app/worker/*` migrated. Shell modules `Header.module.css` + dashboard `(main)/layout.module.css` (reused by worker shell) deleted; `WorkerDashboard.module.css` + `WorkerProfile.module.css` deleted.

### Onboarding — ✅ done
`onboarding/*` (layout, page, role-selection, step1–4, complete), `onboarding-worker/*` (layout, page), `components/onboarding/Stepper` — legacy `Modal`/`Select`/`Checkbox`/`Input`/`Button`→shadcn; 5 modules deleted.

### System — ✅ done
`system/layout`, `system/manual/page`, `components/system/*` (SystemUsersClient/SystemLoginClient/UserDetailClient/DeleteUserModal) — `system.module.css` + `manual.module.css` deleted. `video-courses` was already migrated.

### Marketing / misc — ✅ done
`app/page` + `app/_components/*` (HowItWorks/InspectorsSection/InspectorsActions/FeatureSection/FeatureAccordion/Footer/ClientTypingEffect), `request-demo`, `privacy`, `terms`, `not-found` — 12 modules deleted. (Footer LinkedIn brand glyph kept inline — no lucide equivalent.)

### Shared primitives & styleguide — ✅ done
`DatePicker` (off legacy Button), `FileUpload`, `PhoneInput`, `TagInput`, `TimePicker`, `/styleguide` — all 6 modules deleted; public APIs unchanged.

### Legacy retirement — ✅ done
`legacy/Button|Input|Modal|Select|Checkbox.tsx` + their `.module.css` **deleted**; barrel (`components/ui/index.ts`) legacy exports removed. `legacy/ModalContext.tsx` kept (functional priority-based modal coordination; consumed by Providers/DashboardEmptyState/WorkerEmptyState/OrganizationActivationModal/WorkerWelcomeModal).

---

## Overall module.css burn-down
- **2026-06-14: 0 remaining — migration complete.** (44 → 0 this pass: 2 orphans; onboarding −5; worker/shell −4; staff −1; profile −2; billing/auditor −2 [`auditor-pack` migrated]; marketing −12; system −2; primitives −5; styleguide −1; legacy components −5. The 5 `legacy/*.module.css` went with their deleted components.) `find src -name "*.module.css" | wc -l` → 0.
- **Start of migration:** 81 `.module.css` files.
- **2026-06-11 (course/training slice):** 64 → **44 remaining** (−20 this pass: documents detail/upload/PdfViewer −4 [incl. orphaned parent]; all training modals/views + onboarding −8; queue/mapping/AssignUserCourseModal/ConfirmPublishModal/CourseSuccessModal −6; CoursePlayer shared −1; CourseWizard + Step1Category shared −2 — note some passes deleted 1 shared module covering many files). **All course-related modules eliminated.** Remaining 44 are worker/learn-shell, onboarding, system, billing, profile, auditor slices + intentionally-kept `StaffList.module.css` (RemoveStaffModal) and the two shell modules (worker slice). Gates green: `npm run lint` + `tsc --noEmit` + `npm test` (88/88).
- **Earlier:** 64 remaining (auth −10; dashboard shell −1; dashboard home −1; the two shared shell modules deferred to the Worker slice). Run to refresh:
  ```bash
  find src -name "*.module.css" | wc -l
  ```

## Known follow-ups / debt
- ✅ `components/auth/MfaSettings.tsx` migrated off legacy `Button` (profile/settings slice).
- ⬜ Visual-regression snapshots (Playwright) deferred from auth — add once a slice stabilizes.
- ✅ Login no longer enforces `PASSWORD_MIN_LENGTH` (fixed; existing short-password users can log in).
- ⬜ Pre-existing: login uses a permissive email regex (`/\S+@\S+\.\S+/`) — matches signup; revisit if stricter validation is wanted.

## Decisions log
- **2026-06-10** Strategy = extract-as-you-go + documented convention (Approach C). Fidelity = "Figma as direction + judgment". Verification = user-run + Playwright screenshots.
- **2026-06-10** Two systemic `globals.css` fixes (shadcn tokens + `@layer base`) — see [[project-tailwind-shadcn-foundation]] / `ui-migration-pattern.md` §0.
- **2026-06-11** Control sizes from the login Figma adopted as **global** defaults. Use `size="sm"` for dense/table contexts.
- **2026-06-11** Primary CTAs are **gated on form-completeness** (grey until required fields filled, purple when ready); loading keeps brand colour.

## How to resume / verify
- Dev server: `npm run dev` (port 3005). Screenshot any route at 3 breakpoints: `npx tsx scripts/shot.ts <route>`.
- Gates before handing a page off: `npm run lint && npx tsc --noEmit && npm test`; production build `npm run build`.
- Per-page procedure + gotchas: `docs/ui-migration-pattern.md`.
- Figma: file key `cySAabdYLDKzwbs88owBHn` (THERAPTLY); token in `.env` (`FIGMA_ACCESS_TOKEN`). Ask the user for the specific frame/node link when a layout is unclear.
