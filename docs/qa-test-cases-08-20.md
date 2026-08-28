# Theraptly LMS — Test Cases (2026-08-20)

> Converted from the 2026-08-20 QA test-case export (Google Docs) for use as QA agent
> instructions. This is the **catalog** — it is organised by role for reading. The
> **execution order** lives in the companion [`qa-testing-phases-08-20.md`](./qa-testing-phases-08-20.md).
> Reference this catalog when planning or executing QA rounds; report results per test case ID.

**Target environment:** `https://staging-lms.theraptly.com` (staging, dev line — full multi-facility).

## Format contract

Each test case has a unique ID, a status flag, an actor/role, preconditions, numbered steps, and a
single unambiguous expected result. Execute steps in order. A test fails if the actual result differs
from the expected result at any step.

## Status flags — read this before executing

Each case carries a flag recording what a white-box read of the codebase says to expect. This exists
so a live run does not waste time hunting for UI that was never built, and so genuine spec drift is
reported as a defect rather than as tester error.

| Flag           | Meaning                                  | What the tester should do                                                                                                           |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `[OK]`         | Implemented as written                   | Execute normally; record PASS or FAIL                                                                                               |
| `[SPEC-DRIFT]` | The code contradicts the expected result | Expect **FAIL**. Record actual behaviour and move on — do **not** debug or hunt for a hidden path. The defect is already pre-filed. |
| `[NOT-IMPL]`   | The feature is absent from the codebase  | Record **BLOCKED — not implemented**. Do not search the UI for it.                                                                  |

`[SPEC-DRIFT]` cases are deliberate. They encode the agreed business intent, which the current build
does not satisfy. Their failure is the finding.

## General QA guidelines (apply to every test case)

1. **Happy path.** Unless a case is marked `(negative)`, the flow must complete with no errors,
   no dead ends, and no blank states.
2. **State changes.** Every action that changes data must persist — reload the page and confirm.
3. **Copy quality.** Error and confirmation messages must be specific and human-readable. A generic
   or blank failure is itself a defect.

## Contents

| Section                                              | Test cases                | Phase   |
| ---------------------------------------------------- | ------------------------- | ------- |
| [Owner — Onboarding](#owner--onboarding)             | TC-OB-001 – TC-OB-008     | 1       |
| [Owner — Document Hub](#owner--document-hub)         | TC-DH-001 – TC-DH-004     | 4       |
| [Owner — Courses](#owner--courses)                   | TC-CRS-001 – TC-CRS-010   | 4, 5, 6 |
| [Owner — Status Tracker](#owner--status-tracker)     | TC-ST-001 – TC-ST-004     | 6       |
| [Owner — Staff Management](#owner--staff-management) | TC-SM-001 – TC-SM-006     | 3, 9    |
| [Owner — Audit Reports](#owner--audit-reports)       | TC-AR-001 – TC-AR-003     | 6       |
| [Owner — Billing](#owner--billing)                   | TC-BILL-001 – TC-BILL-009 | 2, 9    |
| [Owner — Settings](#owner--settings)                 | TC-SET-001 – TC-SET-005   | 3       |
| [Admin](#admin)                                      | TC-ADM-001 – TC-ADM-003   | 3, 7    |
| [Facility Supervisor](#facility-supervisor)          | TC-SUP-001 – TC-SUP-008   | 7       |
| [Clinical Director](#clinical-director)              | TC-CD-001 – TC-CD-006     | 7       |
| [HR](#hr)                                            | TC-HR-001 – TC-HR-006     | 8       |
| [Finance](#finance)                                  | TC-FIN-001 – TC-FIN-003   | 8       |
| [Worker](#worker)                                    | TC-WRK-001 – TC-WRK-009   | 5, 8    |

**Total: 84 test cases** (78 from the source export + 6 new Clinical Director cases).

## Roles and routes — naming reference

The source export used product names that differ from what the app actually renders. Use these:

| Source export says    | Actual route                                      | Actual UI label                                                          |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Document Hub          | `/dashboard/documents`                            | Documents                                                                |
| Courses               | `/dashboard/courses`, `/dashboard/courses/create` | Courses                                                                  |
| Status Tracker        | `/dashboard/status-tracker`                       | Status Tracker                                                           |
| Staff Management      | `/dashboard/staff`                                | Staff Management                                                         |
| Audit Reports         | `/dashboard/audit-reports`                        | Audit Reports                                                            |
| Billing               | `/dashboard/billing`                              | Billing                                                                  |
| Settings > Facilities | `/dashboard/settings` → **Facility** tab          | Facility (singular — there is no `/dashboard/settings/facilities` route) |
| Worker Trainings      | `/worker/trainings`                               | Trainings                                                                |

**"Worker" is not a role.** `UserRole` has 14 values and none of them is `worker`. Eight job roles
(`nurse`, `front_desk_admin`, `therapist_clinician`, `case_manager`,
`behavioral_health_technician`, `peer_support_specialist`, `psychiatrist_prescriber`,
`facilities_support`) share one identical learner permission set. Run every Worker case as
**`front_desk_admin`** (the self-serve default) or **`nurse`**.

The six manager roles are `owner`, `admin`, `supervisor` (Facility Supervisor), `hr`,
`clinical_director`, `finance`.

---

## OWNER

### Owner — Onboarding

**TC-OB-001 — Full onboarding completes without errors** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Fresh account, no organization created yet
- **Steps:**
  1. Start the onboarding flow as a new Owner at `/onboarding/step1`
  2. Complete every step through to the end (step1 → step5 → complete)
- **Expected Result:** Onboarding finishes and lands on the dashboard with no error states at any step
- **Notes:** Onboarding is 5 steps: Org details → Credentialing → Services → Invite Team Members →
  Invite Workers. State is held client-side and assembled at final submit — you must walk step1→step5
  in **one browser session**, or completion fails with "Missing Organization Data (Step 1)". The
  organization **and its first facility** are both created from step 1's data at submit.

**TC-OB-002 — Skip button absent on organization details step** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on `/onboarding/step1` (organization details)
- **Steps:**
  1. Load the organization details step
  2. Inspect the UI for a Skip button
- **Expected Result:** No Skip button is present on this step. All other steps are out of scope for
  this check.
- **Notes:** Expected to pass — Skip controls exist only on steps 4 and 5.

**TC-OB-003 — Facility type field is a dropdown** `[NOT-IMPL]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress
- **Steps:**
  1. Look for a facility-type field anywhere in the onboarding flow
- **Expected Result:** Field renders as a dropdown (select) with predefined options, not a free-text
  input
- **Notes:** **There is no facility-type field in onboarding.** Step 1 collects legal name, DBA, EIN,
  staff count, primary contact, country and state — no facility type. The facility-type control is a
  multi-select that lives in Settings → Facility → Add facility. Record BLOCKED and verify the
  dropdown behaviour under **TC-SET-001** instead.

**TC-OB-004 — Business type field is a dropdown** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on `/onboarding/step3` ("Help us understand your Services")
- **Steps:**
  1. Load the primary business type field
  2. Attempt to interact with it
- **Expected Result:** Field renders as a dropdown with predefined options, not free text
- **Notes:** Business type is on **step 3**, not step 1 — the source export incorrectly stated this
  shares TC-OB-003's precondition. Step 3 has `primaryBusinessType` (single) plus
  `additionalBusinessTypes` (multi), each with an "Other" free-text escape hatch that appears only
  when Other is selected.

**TC-OB-005 — Staff added during onboarding appear in Staff Management** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on the staff addition steps
- **Steps:**
  1. Add one manager on step 4 and one worker on step 5, manually
  2. Complete onboarding
  3. Navigate to `/dashboard/staff`
- **Expected Result:** Both the manager and the worker added during onboarding appear in the Staff
  Management list with correct name, email, and role
- **Notes:** Managers and workers are split across two steps — step 4 takes `MANAGER_INVITE_ROLES`,
  step 5 takes worker roles. Both create **invites**, so the rows may show as pending/invited rather
  than active until each invite is accepted. Invites expire after 7 days.

**TC-OB-006 — CSV upload works during onboarding** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on step 4 or step 5, valid sample-formatted CSV available
- **Steps:**
  1. Select the CSV upload option ("Import with .csv file instead")
  2. Upload a correctly formatted CSV containing multiple staff rows
- **Expected Result:** All staff rows from the CSV are added and appear in the review/confirmation
  list before continuing
- **Notes:** Accepts `.csv` and `.xlsx`. Limits: 1000 rows, 5 MB. The required header is `email`.

**TC-OB-007 — Sample CSV download works** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on step 4 or step 5
- **Steps:**
  1. Click "Download sample .csv template"
- **Expected Result:** A CSV file downloads and contains the correct column headers expected by the
  upload parser
- **Notes:** There are **two different templates** — step 4 downloads `managers-template.csv`, step 5
  downloads `workers-template.csv`. Check both.

**TC-OB-008 — Invalid CSV is rejected with clear error** `[OK]`

- **Phase:** 1
- **Role:** Owner
- **Preconditions:** Onboarding in progress, on step 4 or step 5, malformed CSV available (wrong
  columns or missing required fields)
- **Steps:**
  1. Select CSV upload
  2. Upload the malformed CSV
- **Expected Result:** Upload is rejected. A specific, human-readable error is shown identifying the
  problem (not a blank failure or generic error)
- **Notes:** **CONFIRMED FAIL on step 4 — defect `P1-004`** (run of 2026-08-20). Step 4 silently
  discards invalid and duplicate rows with zero feedback; step 5 correctly reports
  "Some rows need attention" with per-row numbers, values and reasons. **Test both steps
  separately** — a pass on step 5 says nothing about step 4.
  Root cause is a single line: `step4/page.tsx:131` destructures only `{ invites }` from
  `extractManagerInvitesFromRows`, dropping the `skipped[]` diagnostics returned alongside it. The
  formatter `summariseSkippedCsvRows` already exists and is already used by step 5 and by
  `InviteStaffModal`.
  _(Supersedes the pre-filed note that `InviteStaffModal` shares this bug — it calls the formatter at
  two sites and is no longer affected. Step 4 is the only remaining site.)_

---

### Owner — Document Hub

> Access/audit logging for Document Hub (who accessed or modified what, when) is **explicitly out of
> scope** for this pass.

**Setup required for all Document Hub cases.** PHI scanning is **fail-closed**: if Vertex AI is
unreachable or misconfigured, every upload is blocked with "We could not verify this document for
PHI." Confirm AI credentials are live on staging before starting, or all four cases fail for the
wrong reason. A local regex also hard-blocks **before** any AI call — SSN, **any email address**, and
**any formatted phone number** are high-confidence blocks. The "clean" test document must therefore
contain **no email address and no phone number** (a letterhead footer will fail the test). Fixtures
exist at `docs/local/test-fixtures/`. Only PDF/DOCX with extractable text are accepted; scanned
images are rejected. Rate limit: 20 scans / 5 min / user.

**TC-DH-001 — Document upload triggers PHI scan** `[OK]`

- **Phase:** 4
- **Role:** Owner / Admin / HR
- **Preconditions:** On `/dashboard/documents`, a test document with no PHI available
- **Steps:**
  1. Select a category (required first step), then select a document with no PHI content
  2. Initiate upload
- **Expected Result:** A PHI scan runs before the document is accepted (visible scanning state or
  equivalent confirmation)

**TC-DH-002 — Document containing PHI is rejected** `[OK]`

- **Phase:** 4
- **Role:** Owner / Admin / HR
- **Preconditions:** On `/dashboard/documents`, a test document containing PHI available (e.g. name +
  diagnosis, or an SSN pattern)
- **Steps:**
  1. Select the document containing PHI
  2. Initiate upload
- **Expected Result:** Upload is rejected outright. The document is **NOT** saved in any form (not
  flagged-but-stored, not partially saved). The user is shown a rejection message.
- **Notes:** Expected message: "This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be
  uploaded." Rejection is strict — verify the file does not appear in the list after the attempt.

**TC-DH-003 — Upload blocked without disclaimer checkbox** `[OK]`

- **Phase:** 4
- **Role:** Owner / Admin / HR
- **Preconditions:** On `/dashboard/documents`, valid non-PHI document selected
- **Steps:**
  1. Select a valid document
  2. Leave the disclaimer checkbox unticked
  3. Attempt to submit the upload
- **Expected Result:** Upload is blocked. The submit action is disabled or returns an error until the
  checkbox is ticked.
- **Notes:** The checkbox reads "I verify this document contains no Personal Health Information
  (PHI)." It is enforced both client-side (submit disabled) and server-side.

**TC-DH-004 — Upload succeeds with disclaimer ticked and no PHI** `[OK]`

- **Phase:** 4
- **Role:** Owner
- **Preconditions:** Valid non-PHI document selected (no email address, no phone number)
- **Steps:**
  1. Select a valid document
  2. Tick the disclaimer checkbox
  3. Submit the upload
- **Expected Result:** Document uploads successfully and appears in the documents list

---

### Owner — Courses

**Billing gate.** Course creation **and** course assignment both require an active subscription. With
no plan, "Create Course" only opens "A plan is required to create courses". Phase 2 must complete
before any of these cases can run.

**TC-CRS-001 — View a video course** `[OK]`

- **Phase:** 4
- **Role:** Owner / Admin / HR / Clinical Director
- **Preconditions:** Active subscription; at least one global video course published
- **Steps:**
  1. Go to `/dashboard/courses` and select the **Video** tab
- **Expected Result:** Courses are displayed and appear in the video list as a video course
- **Notes:** **Relocated** — the source export placed this on Courses > Create. The Video tab is on
  the Courses **list**, not the create wizard. Organizations **cannot author video courses at all**;
  video courses are platform-global, published by system admins at `/system/video-courses`, and orgs
  only browse and assign them.
  **Updated:** the outer "My Courses" / "Available Video Courses" page tabs no longer exist. The
  global video catalog is merged into the Video tab of the single Courses list, and Video is the
  landing tab unless the org's only content is reading courses.

**TC-CRS-002 — Create a reading course** `[OK]`

- **Phase:** 4
- **Role:** Owner
- **Preconditions:** Active subscription; on `/dashboard/courses/create`
- **Steps:**
  1. Select a course category
  2. Fill required fields and attach reading content
  3. Save
- **Expected Result:** Course is created and appears in the course list as a reading course
- **Notes:** The wizard runs Category → Modules → Audience → Details → Quiz → Quiz Review →
  Assign & Publish. **"Publish Course" opens a "Confirm Course Review" modal** (reviewer name +
  attestation checkbox); navigating away without confirming creates **nothing** — do not mistake
  that for a persistence bug. Drafts autosave to `sessionStorage` for 24h and offer "Resume your
  draft?".

**TC-CRS-003 — Update a reading course** `[OK]`

- **Phase:** 4
- **Role:** Owner
- **Preconditions:** An existing reading course exists
- **Steps:**
  1. Open the existing reading course for editing
  2. Change the title, then change the reading content
  3. Save
- **Expected Result:** Changes persist and are reflected when reopening the course
- **Notes:** Editing is **split across two surfaces** and there is no single course-edit page. Title
  rename happens from the course list. Lesson body and quiz editing happen inside the learner view
  `/learn/<id>` via the admin lesson/quiz editors. Test both halves.

**TC-CRS-004 — No pre-built course option exists** `[SPEC-DRIFT]`

- **Phase:** 4
- **Role:** Owner
- **Preconditions:** On `/dashboard/courses/create`
- **Steps:**
  1. Inspect all course type options offered
- **Expected Result:** "Pre-built course" is not an available option
- **Notes:** **Expect FAIL.** Pre-built is still present at three entry points: the route
  `/dashboard/courses/prebuilt`, a link inside wizard step 1 ("Or choose a prebuilt course on
  Theraptly"), and a "Choose a prebuilt course" button on the courses empty state. The server action
  is still live. Nothing was removed. Record all three locations as evidence.

**TC-CRS-005 — Course details page renders correctly** `[OK]`

- **Phase:** 4
- **Role:** Owner
- **Preconditions:** At least one existing course
- **Steps:**
  1. From the course list, click into a course
- **Expected Result:** Details page loads showing course type, content, and assignment history
  without error

**TC-CRS-006 — Assign course to a single staff member** `[OK]`

- **Phase:** 5
- **Role:** Owner
- **Preconditions:** Active subscription; at least one course and one staff member
- **Steps:**
  1. Open a course
  2. Assign it to one staff member via email
- **Expected Result:** The staff member receives the assignment; it appears on their profile and in
  Status Tracker
- **Notes:** **Set a due date within 7 days.** Status Tracker only queries overdue plus
  due-within-7-days; an assignment with no due date, or one due further out, **never appears there at
  all**. Leaving dates blank auto-computes roughly +31 days, which would make this case fail
  spuriously. "Assign To" is a free-text tag input — type the email and click **Invite** to add a
  chip; there is no autocomplete.

**TC-CRS-007 — Bulk-assign course to multiple staff** `[OK]`

- **Phase:** 5
- **Role:** Owner
- **Preconditions:** At least one course exists, 3+ staff members
- **Steps:**
  1. Open a course
  2. Assign to multiple staff (e.g. 3) via email
  3. Assign
- **Expected Result:** All assigned staff receive the invitation email **individually**; each appears
  correctly in Status Tracker
- **Notes:** One course to many staff = one email per staff member (correct per this case). The
  inverse — many courses to one staff member — deliberately sends a **single consolidated** email.
  Re-assigning an already-enrolled course is silently bucketed as `alreadyAssigned` and sends
  **nothing**; use fresh staff/course pairs or this reads as a false negative.

**TC-CRS-008 — Bulk-assign course to an entire facility** `[NOT-IMPL]`

- **Phase:** 5
- **Role:** Owner
- **Preconditions:** At least one additional facility exists
- **Steps:**
  1. Open a course
  2. Select "assign to facility" and choose the facility
  3. Assign
- **Expected Result:** All staff currently in that facility receive the assignment
- **Notes:** **No facility assign target exists.** Assignment modes are `people` and `role` only.
  Record BLOCKED. **Substitute check:** exercise assign-to-**role** instead (assign to all `nurse`
  users) and record it as supplementary evidence — that path does exist and is untested elsewhere.

**TC-CRS-009 — Certificate has annual expiry set at issuance** `[NOT-IMPL]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** A staff member has completed a course, passed the assessment, and attested
- **Steps:**
  1. View the issued certificate
- **Expected Result:** Certificate shows an issue date and an expiry date exactly one year later
- **Notes:** **The `Certificate` model has no expiry column.** Its fields are id, enrollmentId,
  organizationUserId, courseId, issuedAt, score, pdfStoragePath, pdfGeneratedAt. There is nowhere for
  an expiry to be stored, computed, or displayed. Record BLOCKED.
  **Substitute check:** the nearest real behaviour is `CourseAssignment.renewalCycle` (`annual` =
  365 days measured from completion), where a sweep creates a **new enrollment** 14 days ahead of the
  anniversary. Note that `renewalCycle` defaults to `none` on every assignment path, so it must be
  set explicitly at assign time to exercise it at all.
  _(ID corrected from `TC-CRS-09` in the source export.)_

**TC-CRS-010 — Expired certificate flips staff to non-compliant** `[NOT-IMPL]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** A staff member holds a certificate with an expiry date in the past
- **Steps:**
  1. Load the staff member's status in Status Tracker
- **Expected Result:** Staff shows as non-compliant / expired for that course, not as "completed"
- **Notes:** **Blocked by the same root cause as TC-CRS-009** — no expiry exists, so no
  expiry-driven compliance flip exists anywhere. The precondition cannot be constructed. Record
  BLOCKED.

---

### Owner — Status Tracker

**TC-ST-001 — Active courses listed** `[NOT-IMPL]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** At least one staff member has an in-progress course assignment
- **Steps:**
  1. Open `/dashboard/status-tracker`
- **Expected Result:** The in-progress assignment appears under active/in-progress
- **Notes:** **There is no active/in-progress view.** The tracker queries only two populations:
  overdue (`dueAt < now`) and at-risk (`dueAt` within 7 days). An in-progress enrollment with no due
  date, or a due date more than 7 days out, **never appears**. Record BLOCKED. If the assignment from
  TC-CRS-006 was given a due date inside 7 days it will appear — but as _at-risk_, not as _active_.

**TC-ST-002 — Upcoming deadline courses surface** `[OK]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** A course assignment exists with a deadline within the next 7 days
- **Steps:**
  1. Open `/dashboard/status-tracker`
- **Expected Result:** The assignment appears in the tracker table carrying an amber
  "Due in N days" / "Due today" badge
- **Notes:** **Reworded** — the source export said "upcoming-deadline view/filter". There are no
  tabs, filters, or search on this page. Overdue and at-risk rows share **one merged table** (overdue
  sorted first), and the badge colour is the only thing distinguishing them. The window is a fixed
  7 days, timezone-aware against the worker's facility zone. The only control on the page is the
  facility scope switcher.

**TC-ST-003 — Past-deadline courses listed as overdue** `[OK]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** A course assignment exists with a deadline in the past, not completed
- **Steps:**
  1. Open `/dashboard/status-tracker`
- **Expected Result:** The assignment appears in the tracker table carrying a red "Overdue by N days"
  / "Overdue today" badge, sorted above the at-risk rows
- **Notes:** Same rewording as TC-ST-002 — badge, not filter.

**TC-ST-004 — Expired certifications surface in tracker** `[NOT-IMPL]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** A staff member's certificate has passed its annual expiry (see TC-CRS-010)
- **Steps:**
  1. Open `/dashboard/status-tracker`
- **Expected Result:** The expired certification appears as requiring action, using the same
  overdue/non-compliant treatment as a missed deadline
- **Notes:** **Blocked by the same root cause as TC-CRS-009/010** — no certificate expiry exists.
  Record BLOCKED. _(The source export's precondition pointed at `TC-CRS-011`, which does not exist;
  corrected to TC-CRS-010.)_

---

### Owner — Staff Management

**TC-SM-001 — Staff table shows required columns** `[OK]`

- **Phase:** 3
- **Role:** Owner
- **Preconditions:** At least one staff member exists
- **Steps:**
  1. Open `/dashboard/staff`
- **Expected Result:** The table displays name, email, role, and assigned facility for each staff row
- **Notes:** **Email is not its own column** — it renders beneath the name inside the Name cell.
  Columns are Name / Role / Facility / Date Added / Action. Pass on substance, but record the layout.
  Role, Facility and Date Added are responsive-hidden at small widths — check at desktop width.
  _(Preconditions added; the source export had none.)_

**TC-SM-002 — Staff profile is viewable** `[OK]`

- **Phase:** 3
- **Role:** Owner
- **Preconditions:** At least one staff member exists
- **Steps:**
  1. Click into a staff row
- **Expected Result:** Profile page loads with staff details, role, facility, and course history

**TC-SM-003 — Add staff with facility and role assignment** `[OK]`

- **Phase:** 3
- **Role:** Owner
- **Preconditions:** On `/dashboard/staff`; at least one facility exists
- **Steps:**
  1. Click "Add Staff"
  2. Select a facility (required) and enter the email
  3. Assign a role
  4. Send the invite
  5. Accept the invite as the invited user
- **Expected Result:** The new staff member appears in the list with the correct facility and role
- **Notes:** This is **invite-based**, not direct creation — a 3-step modal (facility + emails →
  role per contact → send). Only roles within the inviter's grantable set are offered. Invites
  expire in 7 days; the acceptance link is `/join/<token>`. On the acceptance form the Terms
  checkbox is a Radix control — it must be clicked via its role, not the native input, or the Create
  Account button stays disabled. Seat limits are enforced at issuance **and** re-checked on accept.

**TC-SM-004 — Assign course from staff profile** `[OK]`

- **Phase:** 5
- **Role:** Owner
- **Preconditions:** A staff member and a course exist; active subscription
- **Steps:**
  1. Open the staff member's profile
  2. Select "assign course"
  3. Choose a course and confirm
- **Expected Result:** Course appears on the staff member's profile as assigned and in Status Tracker
- **Notes:** **Moved Phase 3 → Phase 5 after the run of 2026-08-20.** Its precondition needs a
  course, but courses are not authored until Phase 4 — a test-plan defect, not a product one. The
  Assign-Course UI itself works and shows a clean empty state when the org has no courses.
  Assigning **multiple** courses here sends **one consolidated email** listing all of
  them, not one per course. Cap is 50 courses. Same Status Tracker caveat as TC-CRS-006 — set a due
  date inside 7 days or it will not appear there.

**TC-SM-005 — Removing staff retains their historical data** `[OK]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** A **throwaway** staff member with completed course history and at least one
  certificate exists
- **Steps:**
  1. Open the staff member's profile
  2. Select "remove staff"
  3. Confirm removal
- **Expected Result:** The staff member no longer appears in the active Staff Management list and
  cannot log in. Their course history and certificates are **NOT** deleted — still retrievable via
  Audit Reports > Staff tab.
- **Notes:** **Irreversible in practice — use a throwaway account.** Removal is a soft-delete
  (`active: false`, sessions revoked, pending invites expired). Only active enrollments are deleted;
  terminal statuses and their certificates are retained by design. But a removed user **cannot be
  re-invited through the UI** — invite creation dedupes on globally-existing users and skips them,
  while the user has no organization to log in to. Re-adding needs a backend fix.
  **There is no inactive/archived filter in Staff Management** — the source export offered that as an
  alternative verification path; it does not exist. Verify retention via Audit Reports (TC-SM-006).
  Removing yourself or the owner is blocked.

**TC-SM-006 — Removed staff's data is retrievable in audit reports** `[OK]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Staff member removed per TC-SM-005
- **Steps:**
  1. Go to `/dashboard/audit-reports` > Staff tab
  2. Search/filter for the removed staff member
- **Expected Result:** The removed staff member's course/certificate history is present in the export
- **Notes:** Expected to pass — the auditor staff query filters on organization and worker role with
  no active-only clause, so deactivated members remain listed.

---

### Owner — Audit Reports

**TC-AR-001 — Course tab exports correctly** `[OK]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** At least one course with assignment history exists; Redis healthy
- **Steps:**
  1. Open `/dashboard/audit-reports` > Courses tab
  2. Trigger export
- **Expected Result:** Export downloads and contains accurate course/assignment data
- **Notes:** Export is an **async background job** — start, then poll until ready, then auto-download.
  It requires Redis (`/api/health` must show `redis: connected`). **Only one export may be in flight
  at a time.** The UI hardcodes **CSV** despite the API defaulting to PDF, so expect a `.csv` file
  even though the banner says otherwise.

**TC-AR-002 — Staff tab exports correctly** `[OK]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** At least one staff member with course history exists; Redis healthy
- **Steps:**
  1. Open `/dashboard/audit-reports` > Staff tab
  2. Trigger export
- **Expected Result:** Export downloads and contains accurate staff/completion data
- **Notes:** Same async/CSV caveats as TC-AR-001. Wait for TC-AR-001's job to finish first.

**TC-AR-003 — Facility filter scopes results correctly** `[NOT-IMPL]`

- **Phase:** 6
- **Role:** Owner
- **Preconditions:** 2+ facilities exist, each with distinct staff/courses
- **Steps:**
  1. Open `/dashboard/audit-reports`
  2. Apply a facility filter for Facility A
- **Expected Result:** Only data belonging to Facility A is shown; Facility B data is excluded
- **Notes:** **There is no facility filter in Audit Reports** — the surface has no facility concept
  at all. Tabs are Courses and Staff, with an optional date-range modal. Record BLOCKED.
  **Substitute check:** facility scoping does exist on Status Tracker via the facility scope
  switcher — exercise it there and record as supplementary evidence.
  **Known related defect to re-check:** the bulk organization export ignores the date range even
  though the per-tab exports honour it.

---

### Owner — Billing

**TC-BILL-001 — Subscribe to a plan** `[OK]`

- **Phase:** 2
- **Role:** Owner
- **Preconditions:** Owner account with no active plan
- **Steps:**
  1. Go to `/dashboard/billing`
  2. Select a plan
  3. Confirm the subscription
- **Expected Result:** Plan becomes active; Billing reflects the new plan and status
- **Notes:** **Confirm Stripe is in TEST mode before entering any card** — look for the `test_` URL
  segment and the Sandbox/Test-mode badge. Use `4242 4242 4242 4242` with any future expiry and CVC.
  Four tiers exist, seat-banded: Starter (1–10), Growth (11–50), Pro (51–150), Enterprise (151+,
  contact-sales only, not purchasable). Each has monthly/quarterly/yearly cycles. **This case gates
  Phases 4, 5 and 6** — it must end with an active subscription.

**TC-BILL-002 — Cancel a plan** `[OK]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Owner account with an active plan
- **Steps:**
  1. Go to `/dashboard/billing`
  2. Select "cancel plan"
  3. Confirm
- **Expected Result:** Cancellation is confirmed; the access end date / grace period is clearly shown
- **Notes:** Cancel is **cancel-at-period-end only** — access is retained until the period ends, and
  the UI flips "Next invoice on" to "Cancels on". It does **not** immediately gate features. To
  restore afterwards, just click Resume; do not re-checkout. Re-cancelling returns a conflict error.

**TC-BILL-003 — Pause a plan** `[OK]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Owner account with an active plan
- **Steps:**
  1. Go to `/dashboard/billing`
  2. Select "Cancel or pause plan"
  3. Select "Pause plan"
  4. Confirm
- **Expected Result:** Plan shows as paused; the effect on access and the next billing date is
  clearly shown
- **Notes:** Pause is entered from a "Pause Instead" option **inside the cancel page**. Duration is
  1–3 months. **Pause is the only state that actually flips access off** — it disables course
  creation, course assignment and auditor export. Run this **after** TC-BILL-002 and resume promptly.
  **Known defects to re-check:** course assignment and the entire worker portal are **not**
  billing-gated, so a paused org can still assign courses and its workers keep full access. Also a
  stale "Paused" banner may persist after resume until a manual reload.

**TC-BILL-004 — Plan options restricted by staff count** `[OK]`

- **Phase:** 2
- **Role:** Owner
- **Preconditions:** Organization with a known **declared** staff count
- **Steps:**
  1. Go to `/dashboard/billing` > plan selection
- **Expected Result:** Only plans that support the declared staff count are selectable; smaller-tier
  plans are disabled or hidden
- **Notes:** **This keys off the facility's _declared_ `staffCount` string typed during onboarding —
  not the live roster.** To set up this case you edit the facility's declared staff count, not the
  number of members. (TC-BILL-008 uses the _real_ roster — two different systems; do not conflate
  them.) Upgrades are allowed, downgrades blocked. Server returns 422 "Your organization has too many
  staff members for this plan."
  **Known dead-end to watch:** for an 11–50 org, Starter is correctly disabled but the current tier
  shows as "Current Plan" on _every_ billing cycle, so a cycle change may be impossible.

**TC-BILL-005 — Add a card** `[OK]`

- **Phase:** 2
- **Role:** Owner
- **Preconditions:** Owner account, on Billing > Payment Method
- **Steps:**
  1. Select "Add Payment Method"
  2. Enter valid test card details
  3. Save
- **Expected Result:** Card is added and appears as an available payment method
- **Notes:** **The card is entered on Stripe's hosted Billing Portal, off-app** — the button
  redirects to `billing.stripe.com`. Confirm the `test_` tell first. In Stripe Checkout the card
  accordion can swallow clicks on the "Card" label; click the accordion item container instead.

**TC-BILL-006 — View and download invoices** `[OK]`

- **Phase:** 2
- **Role:** Owner
- **Preconditions:** Owner account with at least one past invoice (TC-BILL-001 produces one)
- **Steps:**
  1. Go to Billing > Billing History
  2. Select an invoice
  3. Download it
- **Expected Result:** Invoice is viewable in-app and downloads as a file (e.g. PDF) with the correct
  amount and date
- **Notes:** The download is an anchor to a Stripe-hosted PDF URL; if Stripe returned no URL, no link
  renders. **Known defect to re-check:** the displayed price may not reconcile with the amount Stripe
  actually charged — compare the UI figure against the invoice total explicitly.

**TC-BILL-007 — Failed payment triggers dunning, not silent lockout** `[SPEC-DRIFT]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Owner account with an active plan, payment method set to fail (Stripe test card)
- **Steps:**
  1. Trigger a billing cycle charge
- **Expected Result:** Payment fails visibly; the owner is notified and given a defined retry/grace
  period rather than immediate service lockout or a silent failure
- **Notes:** **Expect FAIL.** The webhook records the invoice as uncollectible and nothing else —
  there is **no dunning email, no banner, no retry UI and no grace period**. Worse, a `past_due`
  subscription is not treated as active, so the org is **silently locked out** of course creation and
  assignment. That is precisely the failure mode this case was written to catch. Record it and move
  on; do not hunt for a dunning surface.

**TC-BILL-008 — Adding staff beyond plan seat limit** `[SPEC-DRIFT]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Plan with a staff limit, organization currently at that limit
- **Steps:**
  1. Attempt to add one more staff member
- **Expected Result:** The plan **auto-upgrades** with a clear notice to the owner
- **Notes:** **Expect FAIL.** The agreed intent is auto-upgrade-with-notice; the implementation
  **blocks** instead, raising a seat-limit error ("Your {plan} plan allows up to N workers…") with an
  upgrade prompt and a banner on the staff list. Record the actual blocking behaviour as the finding.
  This case uses the **real** member count (plus pending invites), unlike TC-BILL-004. The owner is
  exempt from the count.

**TC-BILL-009 — Downgrading plan while over new limit** `[OK]`

- **Phase:** 9
- **Role:** Owner
- **Preconditions:** Organization whose declared staff count exceeds a lower tier's maximum
- **Steps:**
  1. Attempt to downgrade to a plan that does not support the current staff count
- **Expected Result:** Downgrade is blocked or requires staff reduction first, with a clear
  explanatory message — not a silent downgrade that leaves the org over-limit
- **Notes:** Keys off the **declared** staff count, same as TC-BILL-004. Expected server response is
  422 with "Your organization has too many staff members for this plan."
  ⛔ **The seat gate is currently OFF for this org — defect `P3-001` (Critical · revenue), proven
  live in Phase 3.** Do not expect a 422. The query is
  `facilities: { select: { staffCount: true }, take: 1 }` with **no `orderBy`**
  (`checkout/route.ts:88`), feeding `parseInt(organization.facilities[0]?.staffCount ?? '0', 10)`
  (line 96). Facilities created in Settings carry **no declared staff count**, so once a second
  facility exists the value collapses to `0`, which satisfies every plan's `staffMax`. Measured
  before and after: `staffCount "11-49"` → Starter disabled → `POST checkout` **422**; after adding a
  facility, `staffCount null` → Starter enabled → **200 `{scheduled:true}`** with a real Stripe
  schedule. Any organization of any size can move itself to Starter simply by adding a facility
  first — and since facilities cannot be deleted (`P3-003`), the state is un-undoable in-product.
  A second, independent flaw in the same expression: `parseInt` takes the band's **floor**, so
  `"50-499"` evaluates to `50` and satisfies Growth's `staffMax` of 50 (`P2-005`). Both need fixing;
  neither masks the other.
  **For Phase 9, start from `declared = null` and a fully open gate.** Facility order as left by
  Phase 3: (1) `Theraptly QA Aug20 Clinic` — the only one with a declared count, (2)
  `…Annex (North)`, (3) `QA Delete Test A (empty)`. The Clinic still lists first in the UI, yet the
  API returns `staffCount: null`, so `take: 1` is **not** selecting it — establish which row it does
  select.

---

### Owner — Settings

Settings is gated on organization-edit permission — **Owner and Admin only**. Every other role sees a
"You don't have access to Settings" panel rather than a redirect. Facility management is the
**Facility** tab inside `/dashboard/settings`; there is no `/dashboard/settings/facilities` route.

**TC-SET-001 — Add a facility** `[OK]`

- **Phase:** 3
- **Role:** Owner / Admin
- **Preconditions:** Owner or Admin account
- **Steps:**
  1. Go to `/dashboard/settings` → **Facility** tab
  2. Click "Add facility"
  3. Fill the required facility details, including facility type
  4. Save
- **Expected Result:** Facility is created and appears in the facilities list
- **Notes:** Also verify here the assertion relocated from **TC-OB-003** — the facility-type control
  must render as a predefined multi-select, not a free-text input. Record that result against
  TC-OB-003 as well.

**TC-SET-002 — Assign supervisor during facility creation** `[OK]`

- **Phase:** 3
- **Role:** Owner / Admin
- **Preconditions:** On the Add Facility modal; an email address available for the supervisor
- **Steps:**
  1. During facility creation, assign a supervisor via email
  2. Confirm the invitation email is sent successfully
  3. Save
- **Expected Result:** Facility is created with the supervisor correctly assigned
- **Notes:** _(Preconditions added; the source export had none.)_ This case produces the precondition
  for TC-SUP-001 and TC-SUP-002 — use a real QA inbox alias so the onboarding email can be retrieved.

**TC-SET-003 — All facilities viewable in a list** `[OK]`

- **Phase:** 3
- **Role:** Owner / Admin
- **Preconditions:** 2+ facilities exist
- **Steps:**
  1. Go to `/dashboard/settings` → Facility tab
- **Expected Result:** All facilities are listed with correct details
- **Notes:** The tab heading reads "Facility profile" (singular) but renders all org facilities as
  cards. That naming is not a defect.

**TC-SET-004 — Edit a facility** `[OK]`

- **Phase:** 3
- **Role:** Owner / Admin
- **Preconditions:** An existing facility
- **Steps:**
  1. Open the facility
  2. Change a detail (e.g. name or address)
  3. Save
- **Expected Result:** Change persists and is reflected in the facilities list

**TC-SET-005 — Delete a facility with staff still assigned** `[NOT-IMPL]`

- **Phase:** 3
- **Role:** Owner / Admin
- **Preconditions:** An existing facility **with at least one active staff member assigned**
- **Steps:**
  1. Select "delete" on the facility
  2. Confirm
- **Expected Result:** Deletion is **blocked** with a clear message explaining that staff must be
  reassigned or removed first. No staff record is orphaned.
- **Notes:** **Reclassified `[SPEC-DRIFT]` → `[NOT-IMPL]` after the run of 2026-08-20 (defect
  `P3-003`).** Facilities cannot be deleted **at all** — there is no UI control, no server action and
  no route; a repo-wide search for `deleteFacility`/`removeFacility` matches only
  `deleteFacilityComplianceDocument`. So there is no guard to fail: record **BLOCKED**, not FAIL.
  Consequence worth noting alongside `P3-001`: a facility created in Settings is **permanent**, which
  makes the billing-gate bypass below un-undoable through the product.

---

## ADMIN

Admin is granted the **same full permission set as Owner**, including billing. The two differ only in
that Owner is set at org creation and is never grantable or revocable.

**TC-ADM-001 — Owner can assign Admin role** `[OK]`

- **Phase:** 3
- **Role:** Owner
- **Preconditions:** Owner account; a target user exists in the org
- **Steps:**
  1. Go to `/dashboard/staff` (or invite a new user)
  2. Assign the Admin role to the user
- **Expected Result:** The user's role updates to Admin
- **Notes:** Only Owner and Admin may change roles. A user cannot change their own role. Owner is
  never grantable by anyone.

**TC-ADM-002 — Admin has full Owner rights except org deletion** `[OK]`

- **Phase:** 7
- **Role:** Admin
- **Preconditions:** Logged in as Admin
- **Steps:**
  1. Attempt each Owner-level action in turn: Documents, Courses, Staff Management, Audit Reports,
     Billing, Settings
- **Expected Result:** All actions succeed as they would for Owner
- **Notes:** Admin genuinely does have billing access — do not treat billing visibility as a defect.

**TC-ADM-003 — Admin cannot delete the organization** `[OK]`

- **Phase:** 7
- **Role:** Admin
- **Preconditions:** Logged in as Admin
- **Steps:**
  1. Navigate to organization deletion (if visible) or attempt the action directly
- **Expected Result:** The option is not available, or the action is blocked with a permission error

---

## FACILITY SUPERVISOR

**Read this before executing.** On the dev/staging line the Supervisor permission set is
**read-only** — read on every resource except billing, plus a small self-service set. The design
intent is explicit in the code: _"a supervisor's power is SCOPE, not verbs… Cannot create or edit
facilities, cannot change staff roles, and has no billing access whatsoever."_ Supervisors therefore
have no Add Staff, no facility edit, and no course assignment. Two cases below encode the older
business expectation and are expected to fail.

**TC-SUP-001 — Supervisor receives onboarding email on assignment** `[OK]`

- **Phase:** 7
- **Role:** Owner (acting) → Supervisor (recipient)
- **Preconditions:** New facility created, new user assigned as supervisor (per TC-SET-002)
- **Steps:**
  1. Create the facility and assign the supervisor
- **Expected Result:** The assigned user receives an email containing an onboarding link

**TC-SUP-002 — Supervisor completes onboarding from email** `[OK]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Supervisor has received the onboarding email
- **Steps:**
  1. Click the onboarding link in the email
  2. Complete the flow
- **Expected Result:** The supervisor account is activated and lands on their dashboard
- **Notes:** The acceptance link is `/join/<token>` and collects first/last name and password only.
  The Terms checkbox is a Radix control — click it by role, not via the native input.

**TC-SUP-003 — Supervisor can edit their facility's details** `[SPEC-DRIFT]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Logged in as Supervisor
- **Steps:**
  1. Go to the facility profile
  2. Edit a detail
  3. Save
- **Expected Result:** Change persists
- **Notes:** **Expect FAIL.** Supervisor has no facility-edit permission, and facility management
  lives inside Settings, which is Owner/Admin only — a supervisor sees a "no access to Settings"
  panel. Record whether the edit control is hidden, disabled, or present-but-rejected; that
  distinction matters for the fix.

**TC-SUP-004 — Supervisor can view and assign courses within their facility** `[SPEC-DRIFT]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Logged in as Supervisor, staff exist in their facility
- **Steps:**
  1. Go to Courses
  2. Attempt to assign a course to a staff member in their facility
- **Expected Result:** Assignment succeeds and reflects on that staff member's profile
- **Notes:** **Expect partial FAIL.** _View_ should succeed (supervisor has course read). _Assign_
  should be denied — supervisor has no assignment-create permission. Report the two halves
  separately.

**TC-SUP-005 — Staff list restricted to own facility** `[OK]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** 2+ facilities exist with distinct staff; logged in as Supervisor of Facility A
- **Steps:**
  1. Go to `/dashboard/staff`
- **Expected Result:** Only Facility A staff are listed; Facility B staff are absent
- **Notes:** Facility scoping is driven by a URL parameter, not the session token, and an
  inaccessible facility id silently widens to "all" rather than erroring — probe that too.

**TC-SUP-006 (negative) — Supervisor cannot access other facilities' staff** `[OK]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Logged in as Supervisor of Facility A; Facility B exists with staff
- **Steps:**
  1. Attempt to view or act on a Facility B staff member directly, via URL manipulation with a known
     staff ID
- **Expected Result:** Access is denied with a permission error

**TC-SUP-007 — Status Tracker and Audit views restricted to own facility** `[OK]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Logged in as Supervisor of Facility A
- **Steps:**
  1. Open Status Tracker
  2. Open Audit Reports
- **Expected Result:** Both show only Facility A data
- **Notes:** Status Tracker has a real facility scope switcher. **Audit Reports has no facility
  concept at all** (see TC-AR-003) — so if Audit Reports shows cross-facility data, that is a genuine
  scoping gap and should be filed, not dismissed.

**TC-SUP-008 (negative) — Supervisor cannot reach another facility's audit data** `[OK]`

- **Phase:** 7
- **Role:** Supervisor
- **Preconditions:** Logged in as Supervisor of Facility A; Facility B exists
- **Steps:**
  1. Attempt to load Facility B's audit report or status tracker via direct URL/ID manipulation
- **Expected Result:** Access is denied

---

## CLINICAL DIRECTOR

> **New in this pass.** Clinical Director is the sixth manager role and had no coverage in the source
> export. Its permission set is distinct: content and assessment authority, but no staff
> administration and no billing.

**TC-CD-001 — Clinical Director can create and edit courses** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director; active subscription
- **Steps:**
  1. Create a course
  2. View its details
  3. Edit it
  4. Delete it
- **Expected Result:** Each action succeeds

**TC-CD-002 — Clinical Director can create and edit assessments** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director; an existing course
- **Steps:**
  1. Add or edit the quiz/assessment on a course
  2. Save
- **Expected Result:** The assessment change persists
- **Notes:** Clinical Director is the only non-owner/admin manager role granted assessment
  permissions — HR notably is not.

**TC-CD-003 — Clinical Director can assign courses** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director; a course and a worker exist
- **Steps:**
  1. Assign a course to a worker
- **Expected Result:** Assignment succeeds and appears on the worker's profile

**TC-CD-004 — Clinical Director can upload and edit documents but not delete them** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director
- **Steps:**
  1. Upload a document
  2. View it
  3. Edit its metadata
  4. Attempt to delete it
- **Expected Result:** Upload, view and edit succeed. **Delete is denied** — the control is absent or
  the action is blocked.
- **Notes:** Documents are granted create/read/update but **not** delete for this role. A successful
  delete is a genuine RBAC defect. Also re-check the known systemic issue that document upload has a
  weaker server-side gate than the registry implies.

**TC-CD-005 (negative) — Clinical Director cannot access Staff Management** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director
- **Steps:**
  1. Attempt to navigate to `/dashboard/staff`
  2. Attempt to invite a new staff member
- **Expected Result:** Access is denied or the section is not visible, and no Add Staff control is
  offered
- **Notes:** This role holds no user permissions and no invite-create permission, so Staff Management
  should be entirely absent from the sidebar.

**TC-CD-006 (negative) — Clinical Director cannot access Billing** `[OK]`

- **Phase:** 7
- **Role:** Clinical Director
- **Preconditions:** Logged in as Clinical Director
- **Steps:**
  1. Attempt to navigate to `/dashboard/billing`
  2. Attempt to reach billing payment-method and subscription endpoints directly
- **Expected Result:** Access is denied or the section is not visible, for both the page and the
  direct endpoints
- **Notes:** **Known recurring defect — probe the API directly, not just the page.** Billing
  authorization has historically been inconsistent: some routes check the permission registry while
  others use a coarse "is admin role" check that lets supervisor/HR/clinical-director through to real
  Stripe data. The page body may be correctly gated while the endpoints are not.

---

## HR

**TC-HR-001 — HR has global cross-facility view** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR; 2+ facilities exist
- **Steps:**
  1. Open Staff Management, Status Tracker, and Audit Reports in turn
- **Expected Result:** All facilities' data is visible in each area, not restricted to one
- **Notes:** HR is an org-wide role — unlike Supervisor it is not facility-bound.

**TC-HR-002 — HR can upload/view/edit/delete documents** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR
- **Steps:**
  1. Upload a document
  2. View it
  3. Edit its metadata
  4. Delete it
- **Expected Result:** Each action succeeds
- **Notes:** HR does hold full document CRUD, so all four should pass.

**TC-HR-003 — HR can create/view/edit/delete courses** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR; active subscription
- **Steps:**
  1. Create a course
  2. View its details
  3. Edit it
  4. Delete it
- **Expected Result:** Each action succeeds
- **Notes:** HR has course CRUD but **no assessment permissions** — if the course wizard's quiz step
  is reachable and saves, that is worth recording as a possible gap.

**TC-HR-004 — HR can add/assign/remove/transfer staff** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR; 2+ facilities exist
- **Steps:**
  1. Add a new staff member
  2. Assign them a course
  3. Transfer them to a different facility
  4. Remove them
- **Expected Result:** Each action succeeds and is reflected correctly in Staff Management
- **Notes:** Use a **throwaway** member — step 4 is a soft-delete that cannot be undone through the
  UI (see TC-SM-005). Facility transfer is a two-step select-then-confirm modal available from the
  staff row menu and the profile. HR may grant HR, Clinical Director, Finance and worker roles, but
  never Supervisor, Admin or Owner.

**TC-HR-005 (negative) — HR cannot access Billing** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR
- **Steps:**
  1. Attempt to navigate to `/dashboard/billing`
  2. Attempt to reach the payment-method and subscription endpoints directly
- **Expected Result:** Access is denied or the section is not visible, for both page and endpoints
- **Notes:** **Probe the API directly.** Same recurring inconsistency described in TC-CD-006 — the
  page may be gated while endpoints return real Stripe data.

**TC-HR-006 (negative) — HR cannot delete the organization** `[OK]`

- **Phase:** 8
- **Role:** HR
- **Preconditions:** Logged in as HR
- **Steps:**
  1. Attempt to access organization deletion
- **Expected Result:** The option is not available or is blocked

---

## FINANCE

**TC-FIN-001 — Finance can view Billing** `[OK]`

- **Phase:** 8
- **Role:** Finance
- **Preconditions:** Logged in as Finance
- **Steps:**
  1. Navigate to `/dashboard/billing`
- **Expected Result:** Billing data loads correctly
- **Notes:** Finance holds full billing permissions — this is its defining capability.

**TC-FIN-002 — Finance can create/edit/end plans** `[OK]`

- **Phase:** 8
- **Role:** Finance
- **Preconditions:** Logged in as Finance
- **Steps:**
  1. Create a plan change
  2. Edit an existing plan
  3. End a plan
- **Expected Result:** Each action succeeds
- **Notes:** **Run this before Phase 9's destructive billing cases, and restore an active
  subscription afterwards** — ending the plan here would otherwise cascade into the remaining cases.

**TC-FIN-003 (negative) — Finance cannot access Document Hub, Courses, or Staff Management** `[OK]`

- **Phase:** 8
- **Role:** Finance
- **Preconditions:** Logged in as Finance
- **Steps:**
  1. Attempt to navigate to each of Documents, Courses, and Staff Management
  2. Attempt a document **upload** and a staff **removal** directly
- **Expected Result:** Access is denied or the sections are not visible for all three
- **Notes:** **CORRECTED 2026-08-22 (product decision, defect `D-18`): Finance must NOT see courses
  at all.** The registry currently grants `finance → course.read`, so the Courses page loads today —
  but that is now classified as a **defect**, not intended behaviour. Expected end state: Finance has
  no course access and no Courses nav entry. _(Prior note wrongly called Finance's course visibility
  "legitimate"; physical testing issue #9 flagged it and product confirmed it should be removed.)_
  Staff Management should be entirely absent (no user-read), as should Status Tracker (no
  assignment-read) and Audit Reports (no audit-read).
  **Known recurring defects — target these specifically:** document upload has historically had **no
  role gate at all**, and staff removal has used a coarse admin-role check rather than the permission
  registry, letting Finance do both. Attempt both explicitly rather than only checking navigation.

---

## WORKER

Run these as `front_desk_admin` or `nurse`. The worker portal is a separate surface at `/worker` with
its own session cookie; `/dashboard` redirects worker roles to `/worker`.

**TC-WRK-001 — Worker receives email on course assignment** `[OK]`

- **Phase:** 5
- **Role:** Owner/Admin/HR/Supervisor (acting) → Worker (recipient)
- **Preconditions:** Worker account exists, not yet onboarded
- **Steps:**
  1. Assign a course to the worker
- **Expected Result:** The worker receives an email notifying them of the assignment
- **Notes:** Assigning a course the worker already has sends **nothing** — use a fresh course.

**TC-WRK-002 — Worker completes onboarding from email** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker has received the assignment/onboarding email
- **Steps:**
  1. Click the link in the email
  2. Complete onboarding
- **Expected Result:** The worker account is activated and lands on their dashboard
- **Notes:** Radix Terms checkbox — click by role. **Set the worker's full name during or
  immediately after onboarding**: certificate issuance hard-fails without it, which would block
  TC-WRK-007.

**TC-WRK-003 — Assigned course appears in Trainings section** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker onboarded, has an assigned course
- **Steps:**
  1. Go to `/worker/trainings`
- **Expected Result:** The assigned course is listed

**TC-WRK-004 — Worker can take course and assessment** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker has an assigned course
- **Steps:**
  1. Open the course
  2. Complete the content
  3. Start and submit the assessment
- **Expected Result:** The assessment submits and a pass/fail result is returned
- **Notes:** Score is percentage-correct against the quiz's passing score. **The enrollment status is
  set to in-progress regardless of pass or fail** — do not read that as the pass/fail signal; read
  the returned result.
  **Corrected after the run of 2026-08-20.** A failure raises an **in-app** `COURSE_FAILED`
  notification only — it does **not** send an email. The sole quiz-related email is
  `sendQuizLockedEmail` (`email.ts:349`), which fires on the **locked** state after attempts are
  exhausted, not on an individual failure. Do not file a missing admin email on a single failure;
  that is correct behaviour.

**TC-WRK-005 — Worker can request retake on failed assessment** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker has failed an assessment
- **Steps:**
  1. View the failed assessment result
  2. Select "request retake"
- **Expected Result:** The retake request is submitted/granted and the worker can attempt the
  assessment again
- **Notes:** There are **three distinct retake paths** — verify which one the UI actually invokes:
  worker self-serve retake (blocked once attempts are exhausted), request-to-admin (resets to
  enrolled, notifies admins, UI shows "Waiting for admin retake"), and admin-granted retake from the
  staff profile (offered only for _locked_ enrollments).
  **Known defect to re-check:** the self-serve retake has previously **reset** the latest attempt
  instead of appending a new one, so attempts never accumulated and the quiz never locked, allowing
  unlimited retakes. Verify whether attempts now increment 1 → 2 → 3 and then lock.

**TC-WRK-006 — Worker can attest after passing** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker has passed the assessment
- **Steps:**
  1. View the passed result
  2. Complete the attestation step
- **Expected Result:** Attestation is recorded
- **Notes:** The modal requires a typed name **and two checkboxes**.
  **Known high-severity defect to re-check:** the attestation control has previously been gated on a
  strict equality check against the literal role `worker` — which no real user has, since workers
  hold sub-roles like `nurse`. When that bug is present the button never renders, no attestation is
  possible, and **TC-WRK-006, TC-WRK-007 and TC-WRK-008 all become unreachable**. Check this first;
  if the button is missing, mark all three BLOCKED against a single root cause rather than three
  separate defects.

**TC-WRK-007 — Certificate issued after attestation** `[OK]`

- **Phase:** 5
- **Role:** Worker
- **Preconditions:** Worker has completed attestation (TC-WRK-006); worker profile has a full name
- **Steps:**
  1. Check the worker's certificates area
- **Expected Result:** A certificate is present with the correct issue date
- **Notes:** **Scope reduced** — the source export also required a one-year expiry. No expiry field
  exists (see TC-CRS-009), so assert issue date only. Attestation and issuance are **two sequential
  client calls**, not one transaction: if the second fails, the enrollment is attested with no
  certificate. That specific split-state is worth recording if seen.

**TC-WRK-008 — Certificate viewable by admin roles on staff profile** `[OK]`

- **Phase:** 5
- **Role:** Owner / Admin / HR / Supervisor
- **Preconditions:** Worker has an issued certificate
- **Steps:**
  1. Open the worker's staff profile
- **Expected Result:** The certificate is visible and viewable/downloadable from the profile
- **Notes:** There is also a public verification page per certificate — worth a spot check.

**TC-WRK-009 (negative) — Worker cannot access admin routes or other staff data** `[OK]`

- **Phase:** 8
- **Role:** Worker
- **Preconditions:** Logged in as Worker
- **Steps:**
  1. Attempt to navigate to Staff Management, Audit Reports, and Billing
  2. Attempt to view another staff member's profile via direct URL/ID
- **Expected Result:** All attempts are denied with a permission error
- **Notes:** Workers are hard-blocked from `/dashboard` and redirected to `/worker`, so this should
  pass. Confirm the redirect is a genuine block rather than a cosmetic one by also probing an API
  route directly.

---

## Explicitly out of scope for this pass

- Document Hub access/audit logging (who accessed or modified what, when).
- Two-factor authentication, session timeout, Help Center, profile editing and logout — these are
  covered by the earlier catalog, [`qa-test-cases.md`](./qa-test-cases.md) (TC-058 – TC-070).
- Automated regression tests (unit, integration, Playwright e2e) — owned separately under `tests/`.

## Known coverage gaps

Recorded here rather than silently omitted, for a future pass:

- **Video course authoring** cannot be tested from an organization account — it is a platform-admin
  capability at `/system/video-courses`.
- **Multi-org / organization switching** (`/select-organization`) has no cases.
- **MFA, join-by-code, and inactivity timeout** exist in the product but are out of scope above.
- **Certificate expiry and renewal** have no cases that can pass until the feature exists; the
  `renewalCycle` re-trigger sweep is the nearest testable behaviour and is currently untested.
