# LMS Staging Feedback Fix Todo — 23/02/2026

> **Staging:** https://staging-lms.theraptly.com
> **Branch:** feat/feedback-fix-1

---

## Legend
- [ ] Pending
- [x] Done
- 🔴 P0 — Release blocker
- 🟠 P1 — Major, fix before broad rollout
- 🟡 P2 — Medium, important but not a blocker
- 🟢 P3 — Low severity, copy/polish
- 🤖 Ralph-compatible (use `/ralph-loop`)

## CI Gate (run before marking any task verified)
```bash
npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build
```
All 5 checks must pass with 0 errors.

---

# P0 — Release Blockers

---

## Task 1 — ENG-001: Fix Microsoft auth not working during onboarding

**Status:** [ ] Pending
**Severity:** 🔴 P0

### Root Cause
`signIn('microsoft-entra-id', { callbackUrl: '/signup/role-selection' })` is called without accounting for basePath. In `create-auth-instance.ts`, the signIn callback tries to redirect based on user role — but new Microsoft sign-up users have no role yet, causing the callback to fail or redirect incorrectly.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/app/(auth)/signup/page.tsx` | ~35 | callbackUrl passed to signIn |
| `src/lib/create-auth-instance.ts` | ~85–95, ~180–182 | signIn callback role-based redirect logic |

### Fix Steps
1. Read both files fully
2. In `create-auth-instance.ts` signIn callback, add a null/undefined role guard — if user has no role yet, allow flow to continue to `/signup/role-selection` instead of failing
3. Ensure `callbackUrl` resolves correctly using `NEXT_PUBLIC_APP_URL` if needed (not relative path)
4. Test that existing Microsoft login (returning admin + worker users) still works

### Verification
- [ ] Manual: Sign up with a Microsoft account on staging → confirm user lands on role-selection page without error
- [ ] Manual: Existing Microsoft login (admin + worker) still works after the fix
- [ ] E2E Playwright: Mock Microsoft OAuth callback → assert new user lands on `/signup/role-selection`
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
> ⚠️ Not ideal for Ralph — requires live external OAuth. Manual testing is primary verification.

---

## Task 2 — ENG-002 / ENG-018: Fix logout redirect to localhost (admin + worker)

**Status:** [x] Done
**Severity:** 🔴 P0
**Ralph:** 🤖 Yes

### Root Cause
`signOut({ callbackUrl: '/login' })` uses a relative path. With two separate NextAuth instances (`/api/auth` for admin, `/api/auth-worker` for worker), the client-side `signOut` resolves the redirect against the wrong base — defaulting to `localhost` on staging instead of the deployed URL.

### Files Changed
| File | Lines | Note |
|------|-------|------|
| `src/components/dashboard/Header.tsx` | 87 | Admin logout handler |
| `src/components/worker/WorkerHeader.tsx` | 87 | Worker logout handler |
| `src/app/onboarding-worker/page.tsx` | 188 | Onboarding worker logout |

### Fix Applied
Replaced relative `callbackUrl: '/login'` with `` callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` `` in all three logout locations.

### Verification
- [ ] Manual: Click logout on admin dashboard on staging → URL must be `https://staging-lms.theraptly.com/login`, NOT localhost
- [ ] Manual: Click logout on worker dashboard → same check
- [ ] Manual: Click logout on onboarding-worker page → same check
- [ ] E2E Playwright: Login as admin → click logout → assert final URL contains correct domain + `/login`
- [ ] E2E Playwright: Login as worker → click logout → same assertion
- [x] CI Gate: All 5 checks passed

---

## Task 3 — ENG-020: Fix quiz answer selection mismatch (clicking D selects A)

**Status:** [x] Done
**Severity:** 🔴 P0
**Ralph:** 🤖 Yes

### Root Cause
Quiz options were shuffled via Fisher-Yates on every API GET request (`src/app/api/courses/[id]/learn/route.ts` lines 131–141). The UI renders letters A/B/C/D by array index but stores the clicked option text. Since options re-shuffle on every fetch, the visual label no longer matches the stored selection — clicking "D" could select "A".

### Files Changed
| File | Lines | Note |
|------|-------|------|
| `src/app/api/courses/[id]/learn/route.ts` | 128–143 | Removed Fisher-Yates shuffle; options returned in stable DB order |

### Fix Applied
Removed the Fisher-Yates shuffle entirely. Options are returned in their original stored order on every request, making visual labels consistently match selections.

### Verification
- [ ] Manual: Take a quiz on staging — verify clicking each letter option highlights the correct one
- [ ] Manual: Verify quiz scoring still works correctly after fix
- [ ] E2E Playwright: Load quiz → click option at index 3 (D) → assert only that option has selected/highlighted class
- [ ] E2E Playwright: Submit quiz with known correct answer → assert correct score
- [x] CI Gate: All 5 checks passed

---

## Task 4 — ENG-022: Fix worker cannot retake course after reassignment

**Status:** [x] Done
**Severity:** 🔴 P0
**Ralph:** 🤖 Yes

### Root Cause
`findFirst` in `src/app/api/courses/[id]/learn/route.ts` (lines 56–61) fetches enrollments without ordering — returning the old locked enrollment instead of the new retake enrollment created by `assignRetake()`. The locked enrollment causes the frontend to show a "locked" state, blocking the retake.

### Files Changed
| File | Lines | Note |
|------|-------|------|
| `src/app/api/courses/[id]/learn/route.ts` | 56–61, 70–74 | Added `orderBy: { startedAt: 'desc' }` to both `findFirst` calls |

### Fix Applied
Added `orderBy: { startedAt: 'desc' }` so the most recently created enrollment (the retake one with `status: 'enrolled'`) is always returned.

### Verification
- [ ] Manual: Admin assigns retake to a worker → worker logs in → course appears as available → worker can start and complete it
- [ ] E2E Playwright: Complete course → admin assigns retake → worker visits course → assert accessible → worker completes → assert new enrollment recorded
- [x] CI Gate: All 5 checks passed

---

## Task 5 — ENG-024: Fix multiple course creation failing in sequence

**Status:** [x] Done
**Severity:** 🔴 P0
**Ralph:** 🤖 Yes

### Root Cause
`CourseWizard` never reset its `useState` hooks after a successful course creation. All state (formData, generatedContent, documents, step, errors) persisted when the user navigated back to create a second course. Second creation ran with stale state from the first.

### Files Changed
| File | Lines | Note |
|------|-------|------|
| `src/components/dashboard/courses/CourseWizard.tsx` | 20–52, ~222–238 | Extracted `INITIAL_FORM_DATA` constant; full state reset on success before `router.push` |

### Fix Applied
Extracted `INITIAL_FORM_DATA` constant. After `createFullCourse()` succeeds, resets all 11 state variables and `hasAutoAnalyzed` ref before navigating away.

### Verification
- [ ] Manual: Create a course end-to-end → navigate back → confirm wizard starts at step 1 with empty form
- [ ] Manual: Create 3 courses in sequence — all should succeed
- [ ] E2E Playwright: Complete course creation → navigate to create new → assert wizard at step 1 with empty state → complete second course → assert in course list
- [x] CI Gate: All 5 checks passed

---

## Task 6 — Write Playwright E2E tests for all P0 fixes

**Status:** [ ] Pending — do after tasks 1–5
**Severity:** Required for sign-off
**Ralph:** 🤖 Yes

### Scope
Write and run Playwright E2E tests covering all P0 scenarios. Use QA & Testing bundle: `systematic-debugging`, `e2e-testing-patterns`, `browser-automation`, `test-fixing`.

### Test Cases
| Test | Scenario | Assert |
|------|----------|--------|
| ENG-001 | Mock Microsoft OAuth callback | New user lands on `/signup/role-selection` |
| ENG-002 | Admin login → logout | Redirect URL = correct domain + `/login`, NOT localhost |
| ENG-018 | Worker login → logout | Redirect URL = correct domain + `/login`, NOT localhost |
| ENG-020 | Click 4th quiz option (D) | 4th option is highlighted, not 1st; correct answer scores pass |
| ENG-022 | Complete course → retake assigned → revisit | Course accessible, completable, new enrollment recorded |
| ENG-024 | Create course → create another | Wizard at step 1 with empty state; second course created successfully |

### Verification
- [ ] All Playwright tests pass locally
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Write Playwright E2E tests for all P0 fixes: ENG-001 ENG-002 ENG-018 ENG-020 ENG-022 ENG-024. Check existing test directory structure first." --max-iterations 20 --completion-promise "TESTS_PASSING"
```

---

# P1 — Major Issues (fix before broad rollout)

---

## Task 7 — ENG-003: Fix Training Coverage not displaying correctly on Dashboard

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
In `src/app/actions/course.ts` (lines 296–317), the `getDashboardData()` function computes training coverage using three buckets: `completed/attested`, `in_progress`, and `enrolled`. The `notStarted` percentage uses only `enrolledCount / totalEnrollments` — but `enrolled` is the status of newly created enrollments, not all users who haven't started. Users who were never enrolled at all are missed, making the "not started" figure incorrect and causing the total coverage to not add up to 100%.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/app/actions/course.ts` | 296–317 | `getDashboardData()` coverage calculation |
| `src/components/dashboard/training/TrainingDashboard.tsx` | 662–699 | Renders coverage donut chart |

### Fix Steps
1. Read both files fully
2. In `getDashboardData()`, re-derive `notStarted` as: `totalEnrollments - completedCount - inProgressCount` (remainder after all known buckets)
3. Verify the three percentages sum to 100
4. Check the dashboard donut chart renders the corrected values

### Verification
- [ ] Manual: Assign courses to several workers at different stages — verify coverage percentages match actual data
- [ ] Manual: Total coverage percentages (completed + in progress + not started) must equal 100%
- [ ] E2E Playwright: Seed known data → load training dashboard → assert coverage values match expected
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix Training Coverage calculation in getDashboardData() in src/app/actions/course.ts — notStarted should be totalEnrollments minus completed minus inProgress" --max-iterations 10 --completion-promise "COVERAGE_FIXED"
```

---

## Task 8 — ENG-008: Fix added staff not appearing in staff list after creation

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
`createInvites()` in `src/app/actions/invite.ts` (lines 20–165) successfully creates invite records and sends emails, but **never calls `revalidatePath()`**. The staff list page (`/dashboard/staff`) is a Next.js Server Component — without cache invalidation, it serves the stale pre-invite snapshot. The `router.refresh()` call in `InviteStaffModal.tsx` (line ~94) doesn't reliably force a cache bust without the server-side `revalidatePath`.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/app/actions/invite.ts` | ~160 | Add `revalidatePath('/dashboard/staff')` before returning success |

### Fix Steps
1. Read `src/app/actions/invite.ts` fully
2. Add `revalidatePath('/dashboard/staff')` immediately before the `return { success: true }` at the end of `createInvites()`
3. Also add `revalidatePath('/dashboard/staff')` to any other invite-related actions (accept, resend) if they exist

### Verification
- [ ] Manual: Invite a new staff member → close modal → verify new member appears in staff list immediately without manual page refresh
- [ ] E2E Playwright: Invite staff → assert staff name appears in list within 2 seconds
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-008: add revalidatePath('/dashboard/staff') to createInvites() in src/app/actions/invite.ts so newly invited staff appear in the list immediately" --max-iterations 8 --completion-promise "STAFF_LIST_FIXED"
```

---

## Task 9 — ENG-009: Add staff removal flow (remove button, confirmation modal, emails)

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
No remove-staff functionality exists anywhere in the codebase. There is no server action, no button, and no confirmation modal. This is a net-new feature build.

### Files to Change / Create
| File | Action | Note |
|------|--------|------|
| `src/app/actions/staff.ts` | Add | `removeStaff(userId)` server action — soft-delete or deactivate user, send notification emails |
| `src/components/dashboard/staff/StaffListClient.tsx` | Edit | Add remove button per row |
| `src/components/dashboard/staff/StaffProfileClient.tsx` | Edit | Add remove button in header actions |
| `src/components/dashboard/staff/RemoveStaffModal.tsx` | Create | Confirmation modal with reason field |

### Fix Steps
1. Read `src/app/actions/staff.ts`, `StaffListClient.tsx`, `StaffProfileClient.tsx` fully
2. Create `removeStaff(userId)` server action:
   - Verify caller is admin
   - Deactivate or delete the staff user (check if soft-delete pattern exists in schema first)
   - Send confirmation email to admin
   - Send notification email to removed staff member
   - Call `revalidatePath('/dashboard/staff')`
3. Create `RemoveStaffModal.tsx` with confirmation step (name displayed, optional reason, confirm/cancel)
4. Add a "Remove" button to `StaffListClient.tsx` table rows and `StaffProfileClient.tsx` header
5. Wire button → modal → `removeStaff` action

### Verification
- [ ] Manual: Click remove on a staff member → modal appears → confirm → staff removed from list → confirmation email received
- [ ] Manual: Removed staff member cannot log in
- [ ] Manual: Admin receives confirmation email; removed staff receives notification
- [ ] E2E Playwright: Remove staff → assert no longer in staff list → assert cannot log in
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Implement staff removal flow for ENG-009: removeStaff server action in staff.ts, RemoveStaffModal component, remove button in StaffListClient and StaffProfileClient, with confirmation emails" --max-iterations 15 --completion-promise "REMOVE_STAFF_DONE"
```

---

## Task 10 — ENG-010: Restrict retake assignment to one active retake at a time

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
`assignRetake()` in `src/app/actions/course.ts` (lines 907–983) only checks that the original enrollment has `status: 'locked'` — it does not check whether an active retake enrollment (`status: 'enrolled'`, `retakeOf: lockedEnrollment.id`) already exists. An admin can call it multiple times, creating duplicate retake enrollments.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/app/actions/course.ts` | ~936–940 | Add guard before `prisma.enrollment.create` |
| `src/components/dashboard/training/AssignRetakeModal.tsx` | ~35 | Optionally disable button if active retake exists |

### Fix Steps
1. Read `src/app/actions/course.ts` around `assignRetake()` fully
2. After the `status !== 'locked'` check (line 936), add a query:
   ```ts
   const existingRetake = await prisma.enrollment.findFirst({
     where: { retakeOf: enrollmentId, status: 'enrolled' },
   });
   if (existingRetake) throw new Error('An active retake already exists for this enrollment');
   ```
3. In `AssignRetakeModal.tsx`, handle this error gracefully — show a user-facing message instead of a thrown exception

### Verification
- [ ] Manual: Assign retake → attempt to assign again → second assignment should be blocked with a clear error message
- [ ] Manual: First retake still works correctly
- [ ] E2E Playwright: Create locked enrollment → assign retake → attempt second retake assignment → assert error message shown
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-010: prevent multiple retake assignments in assignRetake() in src/app/actions/course.ts — add guard to check if active retake already exists before creating a new one" --max-iterations 8 --completion-promise "RETAKE_GUARD_FIXED"
```

---

## Task 11 — ENG-011: Fix all View buttons reacting when one is clicked

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
`src/components/dashboard/staff/StaffProfileClient.tsx` uses a single shared `isLoadingResult` boolean (line 79) for all enrollment "View" buttons. When any button is clicked, `handleViewResult()` sets this global flag to `true`, disabling and showing a loading spinner on every View button in the list simultaneously.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/dashboard/staff/StaffProfileClient.tsx` | 79, 81–93, 482–484 | Replace shared boolean with per-enrollment loading state |

### Fix Steps
1. Read `StaffProfileClient.tsx` fully
2. Replace:
   ```ts
   const [isLoadingResult, setIsLoadingResult] = useState(false);
   ```
   With:
   ```ts
   const [loadingEnrollmentId, setLoadingEnrollmentId] = useState<string | null>(null);
   ```
3. Update `handleViewResult(enrollmentId)` to set `setLoadingEnrollmentId(enrollmentId)` on start and `setLoadingEnrollmentId(null)` on finish
4. Update each View button's `disabled` and `loading` props:
   ```tsx
   disabled={loadingEnrollmentId === enrollment.id}
   loading={loadingEnrollmentId === enrollment.id}
   ```

### Verification
- [ ] Manual: Staff profile with multiple courses — click one View button → only that button shows loading, others remain clickable
- [ ] E2E Playwright: Render staff profile with multiple enrollments → click View on row 2 → assert rows 1 and 3 buttons are NOT disabled
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-011: replace shared isLoadingResult boolean with per-enrollment loadingEnrollmentId state in StaffProfileClient.tsx so only the clicked View button shows loading" --max-iterations 8 --completion-promise "VIEW_BUTTONS_FIXED"
```

---

## Task 12 — ENG-019: Fix worker Profile button frozen/unresponsive

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
The "Edit Profile" link in `src/components/worker/WorkerHeader.tsx` (lines 250–271) is a `<Link href="/worker/profile">` that navigates correctly — but the worker profile page at `/worker/profile` likely has a broken or missing route handler, or the worker session is not available on that route, causing the page to not render (appears frozen). The profile route exists in the build (`ƒ /worker/profile`) so the issue is likely within the page component itself.

### Files to Investigate
| File | Note |
|------|------|
| `src/app/worker/profile/page.tsx` (or similar) | Check if the page exists, loads session, and renders without error |
| `src/components/worker/WorkerProfileForm.tsx` | Check if the form component loads correctly |
| `src/components/worker/WorkerHeader.tsx` | ~250–271 — confirm href is correct |

### Fix Steps
1. Read `src/app/worker/profile/` directory and the profile page component fully
2. Read `src/components/worker/WorkerProfileForm.tsx` fully
3. Identify why the page appears frozen — likely a missing `await session`, unhandled promise, or uncaught error on mount
4. Fix the root cause (session fetch, data load, or render error)

### Verification
- [ ] Manual: Log in as worker → click Edit Profile → profile page loads and is interactive
- [ ] E2E Playwright: Login as worker → click profile button → assert profile form is visible and fields are editable
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-019: worker Profile button frozen — investigate src/app/worker/profile/ page and WorkerProfileForm.tsx, find why page is unresponsive and fix" --max-iterations 10 --completion-promise "WORKER_PROFILE_FIXED"
```

---

## Task 13 — ENG-021: Fix worker quiz Exit button logging user out

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
In `src/app/learn/[id]/page.tsx` (lines 490–494), the exit handler does:
```ts
router.push(userData?.role === 'admin' ? '/dashboard/courses' : '/dashboard/worker');
```
For workers, this navigates to `/dashboard/worker` — but that route **does not exist**. The worker dashboard is at `/worker`, not `/dashboard/worker`. Navigating to a non-existent route triggers a redirect chain that lands on the login page, which looks like a logout.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/app/learn/[id]/page.tsx` | 492 | Change `/dashboard/worker` → `/worker` |
| `src/components/courses/CourseRail.tsx` | ~48–69 | Verify exit button passes correct path |

### Fix Steps
1. Read `src/app/learn/[id]/page.tsx` lines 488–496 and `src/components/courses/CourseRail.tsx` fully
2. Change the worker exit route from `/dashboard/worker` to `/worker`
3. Confirm the admin exit route `/dashboard/courses` is correct (it is, per build output)

### Verification
- [ ] Manual: Worker completes or exits quiz → lands on `/worker` dashboard, NOT the login page
- [ ] Manual: Admin exits course preview → lands on `/dashboard/courses`
- [ ] E2E Playwright: Login as worker → enter course → click exit → assert URL is `/worker`, not `/login`
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-021: worker quiz exit button navigates to /dashboard/worker which doesn't exist — change to /worker in src/app/learn/[id]/page.tsx line 492" --max-iterations 6 --completion-promise "EXIT_FIXED"
```

---

## Task 14 — ENG-023: Fix Back to Dashboard button ending course creation

**Status:** [ ] Pending
**Severity:** 🟠 P1
**Ralph:** 🤖 Yes

### Root Cause
The "Exit" button in `CourseWizard.tsx` header (line 440) calls `router.push('/dashboard/courses')` directly — bypassing `handleBack()` and discarding all in-progress work without any warning. There is no confirmation dialog, no "are you sure?" prompt, and no draft-save mechanism.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/dashboard/courses/CourseWizard.tsx` | 440 | Add confirmation dialog before navigating away mid-creation |

### Fix Steps
1. Read `CourseWizard.tsx` fully, focusing on the header Exit button (line 440) and existing modal patterns (e.g. `PhiErrorModal`)
2. Add a confirmation guard: when `currentStep > 1`, clicking Exit should show a confirmation dialog ("You have unsaved progress. Are you sure you want to exit?")
3. On confirm → navigate to `/dashboard/courses`
4. On cancel → stay on current step
5. On step 1 (no meaningful progress yet) → exit immediately without dialog

### Verification
- [ ] Manual: Start course creation past step 1 → click Exit → confirmation dialog appears → cancel keeps user on step → confirm navigates away
- [ ] Manual: On step 1, click Exit → navigates away immediately (no dialog needed)
- [ ] E2E Playwright: Progress to step 3 → click Exit → assert confirmation modal appears → click Cancel → assert still on step 3
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-023: add confirmation dialog to CourseWizard Exit button (line 440) so clicking it mid-creation prompts user instead of navigating away immediately" --max-iterations 10 --completion-promise "EXIT_GUARD_FIXED"
```

---

# P2 — Medium Issues

---

## Task 15 — ENG-004: Fix slide UI poor layout and internal scrolling

**Status:** [ ] Pending
**Severity:** 🟡 P2
**Ralph:** 🤖 Yes

### Root Cause
In `src/components/courses/CoursePlayer.module.css`, the `.slideBody` class (lines ~334–346) has `overflow-y: auto`, causing each individual slide to become internally scrollable when content is tall. Combined with `.slideInner` using `flex: 1` and no `max-height` guard on `.slideCard`, the slide layout breaks for longer content.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/courses/CoursePlayer.module.css` | ~334–346 | `.slideBody` — remove `overflow-y: auto`, constrain layout |
| `src/components/courses/CourseSlide.tsx` | — | Verify slide structure matches CSS fix |

### Fix Steps
1. Read `CoursePlayer.module.css` and `CourseSlide.tsx` fully
2. In `.slideBody`, change `overflow-y: auto` → `overflow-y: visible` (or `hidden`) so the slide expands naturally rather than scrolling internally
3. Ensure `.slideCard` or `.slideInner` has appropriate height constraints so content paginates across slides rather than overflowing within one
4. Test with a slide containing short and long content

### Verification
- [ ] Manual: Navigate through generated slides — no single slide should have an internal scrollbar
- [ ] Manual: Slide layout looks clean and consistent across different content lengths
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-004: slide UI internal scrolling — remove overflow-y: auto from .slideBody in CoursePlayer.module.css and fix layout so slides don't scroll internally" --max-iterations 10 --completion-promise "SLIDE_UI_FIXED"
```

---

## Task 16 — ENG-006: Fix article layout and design quality

**Status:** [ ] Pending
**Severity:** 🟡 P2
**Ralph:** 🤖 Yes

### Root Cause
In `src/components/courses/CoursePlayer.module.css`, `.articleContent` (lines ~524–544) has no `max-width` constraint, causing text to stretch full width. Font size is 19px (too large), there are no responsive breakpoints, and the article container uses `overflow-y: auto` without proper inner spacing. The overall result is a poorly formatted reading experience.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/courses/CoursePlayer.module.css` | ~459–544 | `.articleStage`, `.articleContent`, `.articlePaper` — layout + typography |
| `src/components/courses/CourseArticle.tsx` | — | Verify structure matches CSS fix |

### Fix Steps
1. Read both files fully
2. Add `max-width: 720px; margin: 0 auto;` to `.articleContent` to constrain line length
3. Reduce font size from 19px to 16–17px for better readability
4. Add responsive breakpoints for mobile (reduce padding, adjust font size)
5. Ensure adequate vertical spacing between sections

### Verification
- [ ] Manual: Open a course in article view — text is readable, constrained to a comfortable width, no layout breakage
- [ ] Manual: Check on mobile viewport — responsive layout works
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-006: article layout quality — add max-width constraint to .articleContent, reduce font size, add responsive styles in CoursePlayer.module.css" --max-iterations 10 --completion-promise "ARTICLE_UI_FIXED"
```

---

## Task 17 — ENG-012: Fix Billing Overview button permanently highlighted

**Status:** [ ] Pending
**Severity:** 🟡 P2
**Ralph:** 🤖 Yes

### Root Cause
`src/components/billing/BillingPage.tsx` initialises `activeTab` from a URL `?tab=` param (lines 35–36). When navigating between tabs, the `setActiveTab()` call updates local state correctly — but if the URL param isn't updated in sync (no `router.replace` on tab change), re-renders or navigations can reset `activeTab` back to the URL value (which defaults to `'overview'`), making Overview appear permanently active.

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/billing/BillingPage.tsx` | 35–58 | Tab state initialisation and `setActiveTab` handler |

### Fix Steps
1. Read `BillingPage.tsx` fully
2. In the `onClick` handler for each tab, update the URL param alongside state:
   ```ts
   router.replace(`?tab=${tab.key}`, { scroll: false });
   setActiveTab(tab.key);
   ```
3. Alternatively, derive `activeTab` directly from `useSearchParams()` on every render (no separate state needed) so URL is always the single source of truth
4. Verify Overview is only highlighted when `activeTab === 'overview'`

### Verification
- [ ] Manual: Open billing → click Subscription tab → Overview tab is no longer highlighted
- [ ] Manual: Refresh page on Subscription tab → Subscription tab is highlighted (URL preserved)
- [ ] E2E Playwright: Click each billing tab → assert only the clicked tab has active class
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-012: Billing Overview button permanently highlighted — sync activeTab with URL params in BillingPage.tsx so switching tabs correctly updates the active state" --max-iterations 8 --completion-promise "BILLING_TAB_FIXED"
```

---

# P3 — Low Severity / Polish

---

## Task 18 — ENG-007: Fix wrong copy on Course Creation page 3 ("slides" → "questions")

**Status:** [ ] Pending
**Severity:** 🟢 P3
**Ralph:** 🤖 Yes

### Root Cause
In `src/components/dashboard/courses/steps/Step4Quiz.tsx`, line 54 reads:
> "Adding more slides may reduce question quality. We recommend keeping slides concise."

This copy is on the quiz question count field — it should say "questions", not "slides".

### Files to Change
| File | Lines | Note |
|------|-------|------|
| `src/components/dashboard/courses/steps/Step4Quiz.tsx` | 54 | Two occurrences of "slides" → "questions" |

### Fix Steps
1. Read `Step4Quiz.tsx` fully
2. Change line 54:
   - `"Adding more slides may reduce question quality. We recommend keeping slides concise."`
   - → `"Adding more questions may reduce question quality. We recommend keeping questions concise."`

### Verification
- [ ] Manual: Navigate to course creation step 3 (quiz config) — copy reads "questions" not "slides"
- [ ] CI Gate: `npm run lint && npm run format:check && npx tsc --noEmit && npm run test && npm run build` — all pass

### Ralph
```bash
/ralph-wiggum:ralph-loop "Fix ENG-007: wrong copy in Step4Quiz.tsx line 54 — change 'slides' to 'questions' in the helper text below the quiz question count field" --max-iterations 3 --completion-promise "COPY_FIXED"
```

---

# Progress Tracker

## P0
| Task | Ticket | Status | CI | Staging |
|------|--------|--------|----|---------|
| 1 | ENG-001 | ⬜ Pending | ⬜ | ⬜ |
| 2 | ENG-002/018 | ✅ Fixed | ✅ | ⬜ Needs verify |
| 3 | ENG-020 | ✅ Fixed | ✅ | ⬜ Needs verify |
| 4 | ENG-022 | ✅ Fixed | ✅ | ⬜ Needs verify |
| 5 | ENG-024 | ✅ Fixed | ✅ | ⬜ Needs verify |
| 6 | E2E Tests | ⬜ Pending | ⬜ | ⬜ |

## P1
| Task | Ticket | Status | CI | Staging |
|------|--------|--------|----|---------|
| 7 | ENG-003 | ⬜ Pending | ⬜ | ⬜ |
| 8 | ENG-008 | ⬜ Pending | ⬜ | ⬜ |
| 9 | ENG-009 | ⬜ Pending | ⬜ | ⬜ |
| 10 | ENG-010 | ⬜ Pending | ⬜ | ⬜ |
| 11 | ENG-011 | ⬜ Pending | ⬜ | ⬜ |
| 12 | ENG-019 | ⬜ Pending | ⬜ | ⬜ |
| 13 | ENG-021 | ⬜ Pending | ⬜ | ⬜ |
| 14 | ENG-023 | ⬜ Pending | ⬜ | ⬜ |

## P2
| Task | Ticket | Status | CI | Staging |
|------|--------|--------|----|---------|
| 15 | ENG-004 | ⬜ Pending | ⬜ | ⬜ |
| 16 | ENG-006 | ⬜ Pending | ⬜ | ⬜ |
| 17 | ENG-012 | ⬜ Pending | ⬜ | ⬜ |

## P3
| Task | Ticket | Status | CI | Staging |
|------|--------|--------|----|---------|
| 18 | ENG-007 | ⬜ Pending | ⬜ | ⬜ |

---

> **Note:** This file is temporary — delete after all tasks are verified and merged.
