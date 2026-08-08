# Figma v3 (LMS V3, August '26) — Multi-Facility Design Reconciliation

Source: Figma file `THERAPTLY` (`cySAabdYLDKzwbs88owBHn`), page **🧩 LMS V3 (August '26)** (`15038:76076`).
Reconciled against: current implementation on branch `multi-facility`, and `docs/multi-org-schema-upgrade-plan.md`.

## 1. What the v3 design introduces

### 1.1 Global View + facility scoping (the core new concept)

Every major surface (Dashboard, Documents, Courses, Staff) gains a **scope selector** in the
page header: `All Facilities` ⇄ a single facility ⇄ a multi-facility selection.

- **Global dashboard** (`Dashboard - Global View`, ADMINS `15038:91159`): Enterprise Footprint
  (total facilities / total staff), Training Velocity, Risk & Compliance KPIs, a
  "Priority Risks & Deadlines by Facilities" table and a "Facilities Overview" table — each
  facility row shows staff count, active learners, overdue trainings, training completion,
  **audit readiness %, risk level (Low/Medium/High)** and a "View facility dashboard" link.
- **Facility dashboard** (FACILITY SUPERVISOR & HR `15164:113520`): breadcrumb
  `Home / <Facility>`, a facility dropdown switcher, facility-scoped KPIs (Total Courses,
  Total Staff, Average Grade), Performance of Learners chart, Training Coverage donut,
  My Courses table, Status Tracker table.
- **Scope palette** (`Scope Flow 1–4`, `15051:100785` … `15055:101028`): a **⌘K command
  dialog** to search facilities, with facility chips, checkbox **multi-select**
  (space = select, ↵ = view global dashboard), and a **comparison mode** — "2 facilities
  selected" header scope, Facilities Overview "Comparing 2 of 18 facilities", plus a
  Compliance Analysis block (Training Completion Trend this-vs-last month, Training
  Coverage donut) and **Export**.

### 1.2 Doc Hub v2 (`Doc Hub v2 — *`, `Doc Hub — *`, DOCUMENTATION-REPO sections)

- **Operational Categories**: four top-level categories (Facilities & Ops, Workforce & HR,
  Financials, Compliance/Gov) with **sub-folders**, per-category doc counts and an owner
  avatar; **New Folder** button; custom categories (`Document Hub - 5 (custom category)`).
- **Document table**: Facility column — `Global` badge, single facility name, or
  `<Facility> +N` multi-facility chips; Status column reuses the course-generation lifecycle
  (In progress / Completed / Failed → View Course / Retry).
- **Upload with destination**: modal has an **"Available in"** selector — *Global — all
  facilities*, one facility, or several. Copy: "Choose where these documents live — one
  facility, several, or the whole organization. **Supervisors can only pick their assigned
  facilities.**" When page scope is a facility, the selector defaults to (locks to) that
  facility (HR variant: facility-locked).
- **Verification lifecycle**: per-document **Verified / Unverified** badges. Kebab menu:
  **Verify document** (annotated *Clinical · HR*), **Sync to facilities…**,
  **Promote to Global** (annotated *HR only*), Download, Delete.
- **Sync to facilities** modal: checkbox facility list with "Current" tag. Copy: "Synced
  documents **stay one file** — updates and verification apply everywhere at once."
- **Promote to Global** modal: "visible to all 18 facilities… Verified status carries over —
  no re-verification needed… It stays one file: future edits apply everywhere at once."
- Bulk select → **Move to** / **Delete**; document viewer + editor screens with skeleton
  loaders; role-specific hub sections for ADMIN, HR, CLINICAL/QUALITY, FACILITY SUPERVISOR.

### 1.3 Courses (COURSES section + `Courses Flow — *`)

- Course list gains an **`All facilities` scope dropdown**, role-track tabs (General,
  Nurses, Clinicians, Front Desk, Therapists…) and a **Facilities column**
  (`Global` badge / facility name / `+N`).
- **Assign course modal** (`15108:53310`): assign **by role** (track chips), "or invite
  specific staff by email", **"In facilities"** chips (All facilities / specific / +15 more),
  optional completion deadline, CTA "Assign to 34 staff".
- **Share to all facilities (fork)** (`15111:53706`): "Every facility gets **its own copy**
  of this course to run and adapt locally… Copies can be renamed, edited, and assigned
  locally — future edits here won't change them. Existing assignments and progress at
  <origin facility> stay untouched." → fork-on-share, per the PRD.

### 1.4 Staff Management (STAFF MANAGEMENT section, 15 screens)

- Sidebar item **"Staff Management"**; roster table (name/email, role chip, date invited/
  added, View profile), empty state ("Add your first staff").
- **Add Staff** → bulk email entry → **Assign roles** modal (per-email role dropdown +
  "Set every role to" bulk-set) → "Invite 3 staffs".
- **Switch facility modal** (`15168:55501`): move a staff member to another facility —
  radio single-select of facilities with "Current" tag. Copy: "**Facility-specific trainings
  will be replaced by the new facility's mandatory courses.** Completed records and
  certificates stay on this profile."

### 1.5 Settings (ADMIN `15038:123672`)

- Tabs: **Users & Permissions** (member table: system-role chip, status Active,
  last-active, search, Invite user), **Roles**, **Facility**.
- **Roles matrix** ("System roles — platform access"): columns **Owner, HR, Clinical
  Director, Finance, Student** — NAVIGATION rows + ACTIONS & DATA rows (Manage staff
  roster, Invite & change user roles, Build & edit courses, Assign general courses, Assign
  clinical paths, Author clinical assessments, View question-level scores, View completion
  metrics, Manage billing & invoices, **Create & switch facilities**).
- **Facility tab**: "**Active facility**" profile card (name + type editable), subscription
  plan row ("Manage in Billing"), and an **Add Facility** button. Copy references "the
  facility switcher".

### 1.6 Also present (not new concepts)

Admin Overview/People/Exports/Courses/Billing screens, Auditor Pack, course-creation
wizard flows, onboarding `web sign up` mobile screens, Add facility — modal (onboarding
LMS-2xx flows), Status Tracker, Edit Profile — these largely mirror existing surfaces.

---

## 2. Design vs current implementation

The current app is **effectively single-facility-per-org**: facilities are auto-created
during onboarding only, every person-facility link is the single `User.facilityId`, and
queries scope by `organizationId` (often via `facility.findFirst({ organizationId })` —
"the org's one facility").

| # | Design concept | Current state |
|---|---|---|
| 1 | Facility scope selector / switcher on every surface | **Missing.** Only Manage⇄Learn toggle (`SidebarModeSwitcher`). `FacilityTab.tsx:96` copy references a switcher that was never built |
| 2 | ⌘K facility palette + multi-select compare | **Missing.** No `cmdk`, no global keyboard handler, no comparison view |
| 3 | Global dashboard w/ per-facility tables (audit readiness, risk level) | **Missing.** Dashboard metrics are creator-scoped (`createdBy = session.user.id`) + org staff count; no per-facility aggregation, no risk/audit-readiness computation |
| 4 | Facility dashboard (breadcrumb, facility KPIs) | **Missing.** No facility-scoped route or queries |
| 5 | Add/create facility UI (Settings + onboarding modal) | **Missing.** `facility.create` permission declared but has zero call sites |
| 6 | Facility list anywhere | **Missing.** Every read is `findFirst` or `user.facility` |
| 7 | Doc categories / folders / New Folder | **Missing.** Flat table + filename search; no category/folder field on `Document` |
| 8 | Doc facility column (Global / facility / +N) | **Missing.** `Document` has no org/facility column at all — org scope derived via uploader (`user.organizationId`) |
| 9 | Upload "Available in" destination | **Missing.** Upload = file + PHI attestation only |
| 10 | Verified/Unverified + Verify action (Clinical·HR) | **Missing.** Status is `uploaded \| converted`; "verify" today = PHI scan |
| 11 | Sync to facilities / Promote to Global | **Missing.** No concept |
| 12 | Course Facilities column + facility-targeted assignment | **Missing.** `CourseAssignment` is org+role only; `assignCourseToRole` explicitly nulls facility |
| 13 | Share to all facilities (fork) | **Missing.** Only `OrgCourseOffering` (org-granularity, actions unwired to UI) and `Course.isGlobal` (platform catalog flag — different concept) |
| 14 | Staff Management + Switch facility modal | **Partial.** Staff list/detail/invite exist (org-scoped); no facility display, no switch-facility, no per-facility mandatory-course replacement |
| 15 | Bulk Add Staff → per-email role assign | **Exists** (InviteStaffModal, CSV import, per-contact roles). No facility selection — matches design (facility comes from scope) but invite has no facility today |
| 16 | Staff status Active / deactivate | **Missing.** Only hard `removeStaff` (detaches org, deletes enrollments); no deactivate/reactivate |
| 17 | Settings Users & Permissions / Roles / Facility tabs | **Exists** (plus a Notifications tab). Matrix is read-only registry-derived — matches design intent |
| 18 | Roles matrix contents | **Near-match.** Same row set incl. "Create & switch facilities" (currently a no-op capability). ⚠️ Column mismatch: implementation has 6 columns (incl. **Supervisor**); the v3 frame shows 5 (Owner, HR, Clinical Director, Finance, Student) — **Supervisor column absent in the design. Confirm intent** (moved to facility-level concept, or an omission?) |
| 19 | JWT/session facility context | **Missing.** Token/session carry `id, role, organizationId` — no facility |
| 20 | Audit readiness / Export from compare view | **Missing** as designed (org `hasAuditorAccess` + Auditor Pack screens exist as separate concept) |

**Bottom line:** the v3 design's multi-facility layer is almost entirely greenfield. What
exists and survives: page shells (dashboard/documents/courses/staff/settings routes),
the RBAC registry + read-only roles matrix, invite pipeline, PHI upload pipeline,
Manage⇄Learn bridge, and status-tracker plumbing.

---

## 3. Design vs `multi-org-schema-upgrade-plan.md`

The approved plan covers **RBAC + authentication substrate** (User / OrganizationUser /
OrganizationUserFacility, invite facility targeting, session rework). Verdict per area:

### 3.1 Where the plan directly enables the design ✅

- **Supervisors assigned to multiple facilities** ("Supervisors can only pick their
  assigned facilities", scope palette, per-facility doc/course pickers) →
  `OrganizationUserFacility` (many-to-many, per-row `active`, `joinedAt`). Exact fit.
- **Switch facility modal** → for a worker: deactivate/remove old join row, create new one.
  The plan's per-facility `active`/`deactivatedAt` supports revocation cleanly.
- **Staff "Active" status column** (Settings → Users & Permissions) →
  `OrganizationUser.active` + `deactivatedAt` gives soft deactivation the current
  hard-`removeStaff` cannot express.
- **Invites within a facility scope** → `Invite.facilityId NOT NULL` (plan) matches the
  design: Add Staff happens inside a facility context; the invite carries it.
- **"Last active" column** in Users & Permissions → `OrganizationUser.lastLoginAt`.
- **Roles matrix per-org roles** → role lives on the membership (`OrganizationUser.role`),
  which is what a per-org Settings page needs.
- **Session** → `activeOrganizationId` + membership-resolved role supports every org-scoped
  guard the design implies.

### 3.2 What the design needs that the plan deliberately does NOT cover (next schema increment)

These are **not defects in the plan** (it was scoped to RBAC/auth only), but the design
confirms they're coming; the plan's FK repoints should land first since these build on
`OrganizationUser`:

1. **Document facility scope** — a `DocumentFacility` join (document ↔ facility, "stays one
   file") plus a `scope` notion (`global` vs facility-set). Powers the Facility column,
   upload destination, Sync to facilities, Promote to Global.
2. **Document verification** — `verificationStatus` (unverified/verified) +
   `verifiedByOrgUserId` + `verifiedAt`. Distinct from the PHI scan and from
   uploaded/converted lifecycle.
3. **Document categories/folders** — `DocumentCategory` (org-scoped, nestable one level:
   category → sub-folder), default categories seeded (Facilities & Ops, Workforce & HR,
   Financials, Compliance/Gov), `Document.categoryId`.
4. **Course facility scope + fork lineage** — course ↔ facility join (or scope on
   offering/assignment) for the Facilities column; `forkedFromCourseId` for
   Share-to-all-facilities copies ("independent copy… future edits here won't change them").
5. **Facility-targeted assignment** — `CourseAssignment` gains facility targeting
   (design: role × facilities × deadline). Today it's org + role only.
6. **Per-facility mandatory courses** — the Switch-facility copy ("facility-specific
   trainings will be replaced by the new facility's mandatory courses") implies mandatory
   course sets per facility — an assignment-with-facility construct plus switch-time
   re-enrollment logic.
7. **Enrollment facility attribution** — recommend `Enrollment.facilityId` (nullable).
   The plan repoints `Enrollment` to `OrganizationUser`; but per-facility dashboards
   (completion %, overdue by facility) and switch-facility training replacement need a
   deterministic facility on each enrollment — deriving it via join rows is ambiguous for
   multi-facility supervisors.
8. **Per-facility computed metrics** (facility score, audit readiness, risk level, trend
   compare, export) — aggregation logic, no schema change beyond items 5–7.

### 3.3 The RBAC multi-tenancy matrix (Google Doc, added 2026-08-03)

Source: "RBAC matrix for Theraptly LMS"
(<https://docs.google.com/document/d/1tFGKz-UNwVBj66JVHEIC2CRDcfWlDzjokg8WaXKskps>).
Six admin-tier roles × five modules:

| Module | Owner | Admin | HR | Finance | Clinical/Quality | Facility Supervisors |
|---|---|---|---|---|---|---|
| Documents | CRUD | CRUD | CRUD | — | CRU | R |
| Courses | CRUD | CRUD | CRUD | — | CRUD | R |
| Staff Management | CRUD | CRUD | CRUD | — | — | R |
| Billing | CRUD | CRUD | — | CRUD | — | — |
| Audits | CRUD | CRUD | R | — | R | R |

The doc explicitly leaves "tenant-level vs facility-level data access" open — that half is
answered by the schema plan (`OrganizationUser` role = what you can do,
`OrganizationUserFacility` rows = which facilities it applies to).

**Where it agrees with the Figma v3 design:**

- Clinical/Quality: Documents **CRU without delete** matches the Doc Hub kebab (Verify =
  *Clinical · HR*; Delete not offered to Clinical).
- HR: Documents CRUD + Promote to Global (*HR only*) is consistent.
- Finance: billing-only matches both the Figma matrix and the current registry.
- Supervisors read-mostly at org level with facility-scoped reality matches the Doc Hub
  copy ("Supervisors can only pick their assigned facilities").

**RULING (2026-08-03): the RBAC doc is the single source of truth.** Where the Figma v3
frames or the current code disagree with the matrix above, the matrix wins. Resolutions:

1. **Role taxonomy** = Owner, **Admin**, HR, Finance, Clinical/Quality, Facility
   Supervisors (admin tier), plus the existing 8 worker/learner roles (the doc is silent
   on learners; they remain unchanged). The Figma matrix's missing-Supervisor and
   "Student" column are superseded — the Figma Roles tab must be built from the RBAC
   matrix, not from the frame's columns.
2. **`admin` is added to the `UserRole` enum** in the schema plan's (destructive)
   migration — Owner-equivalent CRUD including billing. The JWT guard in
   `create-auth-instance.ts` that kills sessions carrying the *retired legacy* `admin`
   role is removed in the auth rework, and `admin` joins `ADMIN_ROLES` / `GRANTABLE_ROLES`
   etc. (Recorded in `multi-org-schema-upgrade-plan.md`, Decisions §8.)
3. **Supervisor is demoted to read-only** on Documents, Courses, Staff Management, and
   Audits; no Billing. The current registry (supervisor = everything except billing,
   incl. `facility.create/edit` and role-change rights) is rewritten accordingly;
   "Create & switch facilities" becomes Owner + Admin. Facility supervisors' remaining
   power is *scope*, not verbs: their R access spans their assigned facilities
   (`OrganizationUserFacility`). ⚠️ Note this contradicts some v3 Doc Hub frames that
   show supervisors uploading ("Upload · Owner/Supervisor (Global)") — per the ruling,
   supervisors do NOT create documents; those frames apply to Owner/Admin.
4. **HR has full Courses CRUD** (build & edit, not just assign) — overrides the Figma
   matrix's Owner+Clinical-Director-only "Build & edit courses" row.
5. **Clinical/Quality**: Documents CRU (no delete), Courses CRUD, no Staff module,
   Audits read.
6. **Audits** becomes a first-class module/resource in the permission registry
   (Owner/Admin CRUD; HR, Clinical/Quality, Supervisors read).

Schema impact: only the `admin` enum value. Everything else is permission-registry
configuration (`src/lib/rbac/permissions.ts`, `role-utils.ts`,
`roles-matrix-config.ts`), which the plan already keeps per-membership via
`OrganizationUser.role`.

### 3.4 Remaining open questions ⚠️

1. **Course tracks vs worker roles.** The v3 assign-by-role chips (General, Nurses,
   Clinicians, Front Desk, Therapists) look like **course tracks**, overlapping-but-not-
   identical to the 8 worker roles. The RBAC doc (SoT) covers admin tiers only and is
   silent on learners — confirm whether tracks = `UserRole` values or a separate taxonomy.
2. **Facility scope ≠ session state — RESOLVED (user ruling 2026-08-03).** Facility
   scope stays OUT of the JWT/access token: users select which facility to view (or view
   all/multiple), so it's UI/URL state, not a session claim. Implemented accordingly —
   `MembershipClaims` (src/types/next-auth.d.ts) carries only `organizationId`,
   `organizationUserId`, `role`.
3. **Facility card shows a subscription plan** (Settings → Facility: "Growth · Manage in
   Billing"). Billing is org-level (`Subscription.organizationId @unique`); PRD mentions
   headcount-band pricing. Presumably the card just displays the org plan — confirm, since
   per-facility plans would be a billing-model change.
4. **Doc "one file" sync vs course "fork" copy** — the design is intentionally asymmetric
   (documents sync as one file; courses fork into copies). Implementation must not reuse
   one mechanism for both.
5. **`FacilityDocument` overlap** — the design's facility-scoped Doc Hub should build on
   `Document` (+ join), not the write-only onboarding `FacilityDocument` table. Decide
   whether to fold compliance uploads into the hub later or leave them separate.

### 3.5 Sequencing implication

The approved plan remains the correct **first migration**: everything in §3.2 hangs off
`OrganizationUser`/`OrganizationUserFacility` and facility-aware invites. Landing the plan
unchanged, then adding the document/course facility-scope increment as a second migration,
avoids reworking FKs twice. The only plan-level addition worth considering **now** is
`Enrollment.facilityId` (item 7), since enrollments are already being truncated/repointed
in the destructive migration — adding the nullable column in the same pass is free.

## 4. Design changes observed 2026-08-06 (delta since the 2026-08-03 pass)

All node IDs below are new since the Aug 3 inventory (prefixes `15170`+). Frames edited
in place can't be detected by ID; this delta covers additions.

### 4.1 Global View dashboard finalized (`15189:95427/96127/97948`)

Three `Dashboard - Global View` frames replace the earlier ADMINS sketches:

- **Global (all-facilities) dashboard** `15189:95427`: scope dropdown "All Facilities"
  (top-right, next to greeting); three metric groups — **Enterprise Footprint** (Total
  Facilities, Total Staff), **Training Velocity** (Active Workers in Training, Ongoing
  Courses, First-Time Pass Rate), **Risk, Compliance & Deadlines** (Missing Training
  Deadlines, Inactive Staff, Expiring Credentials next 30 days), each with a
  %-from-last-month trend; **Priority Risks & Deadlines by Facilities** table (Staff
  Count, Active Learners, Overdue Trainings, Risk Level chip, "View facility dashboard"
  link, time-range dropdown); **Facilities Overview** table (Active Trainings, Training
  Completion %, Overdue Trainings, Audit Readiness % with Audit-Ready/Needs-Attention/
  Critical chip, Risk Level, "View dashboard"). Sidebar now: Dashboard, Documents,
  Courses, Status Tracker / Staff Management, Audit Reports / Billing, Settings.
- **Facility-scoped dashboard** `15189:96127`: breadcrumb `Home / Northside Clinic`,
  facility switcher dropdown, Create Course; existing single-org widgets (Total Courses /
  Total Staff Assigned / Average Grade, Performance of Learners, Training Coverage donut).
- `15189:97948` extends it with My Courses table + embedded "Choose a Prebuilt Course on
  Theraptly" catalog.

### 4.2 Settings rebuilt (`15217:109430` section) — tabs are now Users & Permissions / Roles / Facility

- **Users & Permissions** `15217:109431`: "Team members" list with **System role** chips
  (Owner, Finance…), status, last active, Invite user.
- **Roles** `15217:109507`: read-only "System roles — platform access" matrix. Columns:
  **Owner, HR, Clinical Director, Finance, Student** — ⚠️ no Admin and no Facility
  Supervisor column, conflicting with the RBAC Google Doc (still ruled SoT). Notable rows:
  Build & edit courses = Owner + Clinical Director only (⚠️ RBAC ruling gives HR Courses
  CRUD; here HR only "Assign general courses"); Settings nav + Invite & change user roles +
  Create & switch facilities = Owner-only; Manage billing & invoices = Owner + Finance;
  new action rows: Assign clinical paths, Author clinical assessments, View question-level
  scores (Owner + Clinical Director).
- **Facility** `15217:109795`: "Facility profile" card for the ACTIVE facility (name,
  type dropdown, Subscription plan "Growth" → Manage in Billing) + **Add Facility**.
- **Add facility modal** `15217:109903` / `15217:110032`: "It starts as its own isolated
  workspace." Fields: Facility name; Facility type as a checkbox list (Community Mental
  Health Center, SUD Treatment Provider, Behavioral Health/Psychiatric Hospital, Integrated
  Primary Care/FQHC, Private Practice, Telehealth-Only, School/Campus-Based, Correctional/
  Justice-Involved, "+ Other (specify)" free text; School/Campus row appears twice — design
  typo); Facility Address; **Supervisor** email ("They'll be invited to manage this
  facility. Leave empty if you'll manage it yourself"); Create facility.

### 4.3 Staff Management: change-facility flow (`15170:178262`, `15170:179129`)

- **Change facility modal**: single-select radio list of the org's facilities (type +
  city), member card with "Current · Northside Clinic" chip, copy: "The staff's training
  records will be preserved. All completed courses and certificates will remain accessible
  on this profile." Confirm dialog: "Switch 'Kathryn Murphy' from 'Northside Clinic' to
  'Downtown Wellness Center'?" — i.e. a **move**, not multi-assign, though the roster
  still shows a "+2" multi-facility badge on one row and row actions include Change
  Facility / Assign Course (`15171:182436/182439`).

### 4.4 Courses: Slides type + role-gated row menu (`15216:110592`, `15229:60914`)

- Courses list now has **Video / Slides tabs** (counts per type) — a new "Slides" course
  format alongside video.
- Row kebab menu in two variants: full (Assign to staff, View Source Document, Duplicate,
  Rename, Delete) vs restricted (Assign to staff, View Source Document only) — a
  role-gated menu consistent with the supervisor read-only ruling (assignment excepted —
  needs a ruling: the restricted variant still shows "Assign to staff").
- Courses widget `15217:109190`: table with **Role** column (General, HR, Nurses,
  Clinicians, Technical Professionals) + role filter chips — course↔role assignment
  surface.

### 4.5 Course creation: prebuilt catalog step (`15203:110598`)

Full-page "Choose a Prebuilt Course on Theraptly" (search + catalog table: HIPAA
Compliance, Data Privacy & Security, Infection Control, Patient Rights; Time App.;
View Course) with a step-loader header, inside COURSE CREATION PROCESS — prebuilt
courses become a course-creation entry path.

### 4.6 Doc Hub: bulk upload refinement (`15170:174481` in `15164:137414`)

"Upload documents" modal: dropzone (PDF/DOCX, 10MB each), multi-file list with per-file
remove and per-file category dropdown internals (`15170:174092+`), "Upload N files" CTA.

### 4.7 RBAC conflicts — RESOLVED by ruling (2026-08-06)

**User ruling: the RBAC Google Doc remains the single source of truth.** The Settings→
Roles matrix in the v3 design (Owner/HR/Clinical Director/Finance/Student columns, HR
without course build/edit, Owner-only Settings) is **overridden wherever it conflicts**
with the doc. Concretely:

1. The implemented 6-admin-role registry (incl. `admin`, supervisor read-only, HR Courses
   CRUD) stays exactly as certified on 2026-08-03 — no changes from the design matrix.
2. The Settings→Roles *screen* is still to be built, but its content must render the
   doc's matrix (i.e. the implemented permission registry), not the design's columns.
3. The restricted course row-menu variant ("Assign to staff" + "View Source Document")
   is mapped per the doc: supervisor gets NO assign action (read-only); the restricted
   menu as drawn fits no doc role exactly — render menus from the registry gates instead
   of copying the mock.
4. Change-facility single-select modal: UI treatment only — the schema keeps
   multi-facility membership (`OrganizationUserFacility`); the modal is a convenience
   "move primary facility" affordance, not a schema constraint.

### 4.8 Reconciliation vs current implementation (non-RBAC items, 2026-08-06)

| # | Design change (§) | Current implementation | Gap |
|---|---|---|---|
| 1 | Global all-facilities dashboard (§4.1) | `dashboard/(main)/page.tsx` is single-scope; no facility scope anywhere in it | **Greenfield.** Needs facility-grouped aggregates (staff count, active learners, overdue, audit readiness, expiring credentials) — all derivable once enrollments/assignments carry `facilityId` (plan §3.2 item 7). "Inactive Staff" maps to `OrganizationUser.active`/`lastLoginAt` (already in schema) |
| 2 | Facility-scoped dashboard + switcher dropdown (§4.1) | Existing dashboard widgets (Total Courses / Staff Assigned / Avg Grade, Performance, Training Coverage) already implemented org-wide | **Partial.** Reuse widgets; add facility filter + breadcrumb. Facility view-scope is UI/URL state per the facility-out-of-JWT ruling — a `?facility=` param or client store, no session change |
| 3 | Settings tabs Users & Permissions / Roles / Facility (§4.2) | **Already implemented**: `SettingsClient.tsx` has exactly these tabs (+ Notifications, which the design omits — keep it) | Cosmetic diff only; verify against mock during UI pass |
| 4 | Add Facility button + modal (§4.2) | `FacilityTab.tsx` shows single facility profile + plan; no create-facility flow anywhere | **Greenfield.** `Facility` model already has `name/type/address`; supervisor-email invite maps to existing facility-aware `Invite` (`Invite.facilityId` exists). Needs a `facility.create` server action gated `owner`-side per RBAC doc |
| 5 | Subscription plan on facility card (§4.2) | `FacilityTab` already renders org-level `planName` | Matches §3.4-3 assumption (org plan displayed on facility card) — no billing change |
| 6 | Staff change-facility flow (§4.3) | No `changeFacility`/`switchFacility` action or UI exists | **Greenfield but schema-ready**: move = rewrite `OrganizationUserFacility` rows for the membership; training records naturally survive (enrollments hang off `organizationUserId`, not facility) — the modal's "records preserved" copy is already true by construction |
| 7 | Courses Video/Slides tabs (§4.4) | `CourseType` enum is `text \| video`; `Course.rawSlidesJson` exists | **Rename/mapping question**: design's "Slides" ≈ existing `text` (slide-based) courses. Tab UI is new; no schema change needed unless a real third type is intended — assume mapping `video→Video`, `text→Slides` until comments say otherwise |
| 8 | Role-gated course row menus (§4.4) | Menu gating now driven by fine-grained `can()` gates (implemented) | Render menu items from registry gates; do not copy the mock's restricted variant (see §4.7-3) |
| 9 | Prebuilt course catalog step (§4.5) | No prebuilt/template course support in code or schema | **Greenfield.** Needs a source for platform-level courses — natural fit: courses owned by the internal `system` org (approved sign-off #1) + a copy-into-org action, which is the same fork mechanic as course sharing (§1.3) — build once |
| 10 | Bulk multi-file upload with per-file category (§4.6) | `ui/FileUpload.tsx` supports `multiple`, but the documents `upload-modal.tsx` takes `files?.[0]` (single) and `Document` has **no category field** | **Partial.** Multi-file: wire existing primitive through the modal + action. Categories: schema addition (`Document.category` or a category table) — belongs in the same next-increment migration as facility scoping for documents (plan §3.2) |

**Sequencing (unchanged from §3.5):** the applied migration stays correct as increment 1.
Items 1, 2, 6, and 10's category/facility scoping all land cleanly in the already-planned
second increment; 3, 5, 7 (UI mapping), 8 are UI-only; 4 and 9 are feature work on
existing schema.
