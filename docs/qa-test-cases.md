# Theraptly LMS — QA Test Cases

> Converted from `Theraptly_LMS_QA_Test_Cases.docx` (generated from `QA_User_Stories.docx`) for use as QA agent instructions. Reference this catalog when planning or executing QA rounds; report results per test case ID.

## General QA Guidelines (apply to every test case)

1. **Happy path**: for every test case, first verify the straightforward, intended path completes and reaches a logical, correct conclusion.
2. **State changes**: after any action that changes state (e.g. cancelling, deleting, submitting), verify the UI reflects the new state and does not present actions that are no longer valid (e.g. a 'Cancel' button should not reappear for something already cancelled).
3. **Copy quality**: on the Help Center and Settings pages specifically, verify all copy is legible, coherent, and relevant to the page it appears on.

## Contents

| Section | Test Cases |
| --- | --- |
| [Admin — Onboarding](#admin--onboarding) | TC-001 – TC-006 |
| [Admin — Document Hub](#admin--document-hub) | TC-007 – TC-012 |
| [Admin — Courses](#admin--courses) | TC-013 – TC-021 |
| [Admin — Status Tracker](#admin--status-tracker) | TC-022 – TC-025 |
| [Admin — Staff Management](#admin--staff-management) | TC-026 – TC-031 |
| [Admin — Audit](#admin--audit) | TC-032 – TC-033 |
| [Admin — Billing](#admin--billing) | TC-034 – TC-041 |
| [Admin — RBAC (Role-Based Access Control)](#admin--rbac-role-based-access-control) | TC-042 – TC-044 |
| [Worker Side](#worker-side) | TC-045 – TC-057 |
| [Platform-Wide — Two-Factor Authentication (2FA)](#platform-wide--two-factor-authentication-2fa) | TC-058 – TC-060 |
| [Platform-Wide — Session Timeout](#platform-wide--session-timeout) | TC-061 – TC-062 |
| [Platform-Wide — Help Center](#platform-wide--help-center) | TC-063 – TC-064 |
| [Platform-Wide — Settings](#platform-wide--settings) | TC-065 – TC-066 |
| [Platform-Wide — Profile Editing](#platform-wide--profile-editing) | TC-067 – TC-068 |
| [Platform-Wide — Logging Out](#platform-wide--logging-out) | TC-069 – TC-070 |

---

## Admin — Onboarding

### TC-001 — Signup via Microsoft auth (error-free)

**Steps:**

1. Navigate to the signup page.
2. Select 'Sign up with Microsoft'.
3. Authenticate with a valid Microsoft account.
4. Complete any consent/permission screens.

**Expected Result:** Account is created successfully with no errors, and the admin lands on the appropriate onboarding or dashboard screen.

### TC-002 — Signup via email

**Steps:**

1. Navigate to the signup page.
2. Select 'Sign up with email'.
3. Enter a valid email address and password.
4. Submit the form.

**Expected Result:** Account is created successfully and the admin is guided to the next onboarding step (e.g. email verification).

### TC-003 — Add staff via email invite

**Steps:**

1. As an admin, navigate to Staff Management.
2. Select 'Add Staff' and choose to invite via email.
3. Enter one or more staff email addresses.
4. Send the invite.

**Expected Result:** Invited staff receive an email invitation and appear in the staff list with a 'pending' status.

### TC-004 — Assign roles to invited staff

**Steps:**

1. While inviting a staff member (or from an existing pending invite), select a role from the available role list.
2. Confirm the invite.

**Expected Result:** The invited staff member is assigned the selected role, and the role is reflected correctly once they accept the invite.

### TC-005 — Add staff via CSV upload

**Steps:**

1. Navigate to Staff Management.
2. Select 'Add Staff via CSV' and upload a correctly formatted CSV file with staff details.
3. Confirm the import.

**Expected Result:** All staff listed in the CSV are added/invited correctly with the correct details and roles, and any malformed rows are flagged with a clear error rather than silently failing.

### TC-006 — Email verification during onboarding

**Steps:**

1. Sign up with a new email address.
2. Check the inbox for a verification email.
3. Click the verification link.

**Expected Result:** The account is marked as verified, and unverified accounts are appropriately restricted from full access until verification is complete.

## Admin — Document Hub

### TC-007 — Upload a document successfully

**Steps:**

1. Navigate to Document Hub.
2. Select 'Upload Document'.
3. Choose a valid file and submit.

**Expected Result:** The document uploads successfully and appears in the document list with correct metadata (name, date, uploader).

### TC-008 — Document does not contain PHI

**Steps:**

1. Attempt to upload a document containing PHI (Protected Health Information), e.g. patient names or medical record numbers.
2. Observe system behavior during/after upload.

**Expected Result:** The system detects and blocks/flags the document as containing PHI, or clearly warns the admin before allowing upload, preventing PHI from being stored improperly.

### TC-009 — File format restricted to .docx and .pdf

**Steps:**

1. Attempt to upload a file in an unsupported format (e.g. .txt, .jpg, .xlsx).
2. Attempt to upload a valid .docx file.
3. Attempt to upload a valid .pdf file.

**Expected Result:** Only .docx and .pdf files are accepted; unsupported formats are rejected with a clear error message.

### TC-010 — Compliance confirmation required before upload

**Steps:**

1. Begin the document upload process.
2. Attempt to proceed without checking the compliance confirmation box.
3. Check the compliance confirmation box and proceed.

**Expected Result:** Upload cannot be completed until compliance confirmation is checked; once checked, the upload proceeds normally.

### TC-011 — View uploaded file in document reader

**Steps:**

1. Select a previously uploaded document from the list.
2. Open it in the built-in document reader.

**Expected Result:** The document renders correctly and legibly in the in-app reader without requiring download.

### TC-012 — Rename and delete a document

**Steps:**

1. Select an uploaded document.
2. Choose 'Rename', enter a new name, and save.
3. Select the document again and choose 'Delete', confirming the action.

**Expected Result:** The document is renamed successfully and reflects the new name throughout the app; the document is permanently removed after deletion and no longer appears in the list.

## Admin — Courses

### TC-013 — Create a course using policy documents

**Steps:**

1. Navigate to Courses and select 'Create Course'.
2. Select an existing policy document from the Document Hub as the source content.
3. Complete course creation.

**Expected Result:** A new course is created using the selected policy document as its content.

### TC-014 — Configure course during creation

**Steps:**

1. During course creation, configure settings such as passing score, retake limits, and duration.
2. Save the course.

**Expected Result:** All configured settings are saved correctly and reflected when the course is viewed or edited afterward.

### TC-015 — Assign course to workers

**Steps:**

1. Select an existing course.
2. Choose 'Assign' and select one or more workers.
3. Confirm assignment.

**Expected Result:** Selected workers are assigned the course and it appears in their learner portal.

### TC-016 — Assign course to specific roles (invite scoped to role)

**Steps:**

1. Select a course and choose to assign it to a specific role rather than individual workers.
2. Confirm assignment.
3. Verify which workers received the course invite.

**Expected Result:** Only workers who currently hold the selected role receive the course invite; workers with other roles are not notified or assigned.

### TC-017 — Navigate away during course creation without losing progress

**Steps:**

1. Begin creating a course.
2. Partway through, navigate back to the dashboard and perform an unrelated task.
3. Return to the course creation flow.

**Expected Result:** The admin can freely navigate away and perform other tasks; returning to course creation preserves progress or allows it to be resumed/re-edited without data loss or errors.

### TC-018 — Set and edit reminders and escalations

**Steps:**

1. During or after course creation, configure reminder and escalation settings (timing, recipients).
2. Save the course.
3. Return later and edit the reminder/escalation settings.

**Expected Result:** Reminders and escalations are saved correctly, trigger as configured, and can be edited afterward with changes taking effect.

### TC-019 — Set course recurrence (annual, bi-annual, quarterly)

**Steps:**

1. During course creation or editing, set the recurrence to Annual.
2. Repeat for Bi-Annual and Quarterly options.

**Expected Result:** Each recurrence option is saved correctly, and the course re-triggers/reassigns to workers on the correct schedule.

### TC-020 — View and edit course content after creation

**Steps:**

1. Select an existing course.
2. View its content.
3. Edit the content and save changes.

**Expected Result:** Admin can view course content clearly and edit it; changes are saved and reflected for future course-takers.

### TC-021 — View and assign video courses

**Steps:**

1. Navigate to Courses and locate a video-based course.
2. View the video content.
3. Assign the video course to a worker.

**Expected Result:** Video course content plays correctly, and the course can be assigned to workers just like document-based courses.

## Admin — Status Tracker

### TC-022 — Status tracker shows workers near/past deadline

**Steps:**

1. Navigate to the Status Tracker.
2. Identify workers who are within the reminder window or have passed their course deadline without completing it.

**Expected Result:** The status tracker accurately lists workers who are close to or have passed their deadline without completion, with clear status indicators.

### TC-023 — Course reminders listed and emailed to worker

**Steps:**

1. Locate a worker approaching a course deadline in the status tracker.
2. Verify the reminder is listed in the tracker.
3. Check the worker's email for the reminder notification.

**Expected Result:** The reminder appears correctly in the status tracker and a corresponding email is sent to the worker.

### TC-024 — Admin reminders sent within 7-day window before deadline

**Steps:**

1. Set a course deadline within 7 days.
2. Observe whether the admin receives a reminder notification.

**Expected Result:** The admin receives a reminder inside the 7-day period before the deadline, not before or after that window.

### TC-025 — Escalation alerts listed and emailed to admin

**Steps:**

1. Allow a worker's course deadline to pass without completion.
2. Check the status tracker for an escalation alert.
3. Check the admin's email for the escalation notification.

**Expected Result:** The escalation alert appears in the status tracker and a corresponding email is sent to the admin.

## Admin — Staff Management

### TC-026 — Add and delete staff

**Steps:**

1. Navigate to Staff Management and add a new staff member.
2. Select an existing staff member and delete them, confirming the action.

**Expected Result:** New staff are added successfully and appear in the list; deleted staff are removed and lose access accordingly.

### TC-027 — Add staff via email and CSV (staff management context)

**Steps:**

1. From Staff Management, add a staff member via email invite.
2. Add staff members via CSV upload.

**Expected Result:** Both methods successfully add staff with correct details, consistent with the onboarding flow.

### TC-028 — Assign roles to invited workers

**Steps:**

1. Invite a worker.
2. Assign a role to them during or after the invite process.

**Expected Result:** The correct role is assigned and reflected on the worker's profile once they join.

### TC-029 — View staff details

**Steps:**

1. Select a staff member from the list.
2. Open their profile/details view.

**Expected Result:** Staff details (name, email, role, status, etc.) display accurately and completely.

### TC-030 — View course, grading, and certificate details on worker profile

**Steps:**

1. Open a worker's profile.
2. Navigate to their course history, grades, and certificates.

**Expected Result:** Course completion status, grades, and issued certificates all display accurately on the worker's profile.

### TC-031 — Assign courses to staff

**Steps:**

1. Select a staff member.
2. Assign one or more courses to them.

**Expected Result:** The selected courses are assigned and appear correctly in the worker's learner portal.

## Admin — Audit

### TC-032 — Export audit logs for workers and courses

**Steps:**

1. Navigate to the Audit section.
2. Select 'Export' for worker audit logs.
3. Select 'Export' for course audit logs.

**Expected Result:** Both exports generate complete, accurate log files reflecting worker and course activity.

### TC-033 — Request audit for a specific time period or date range

**Steps:**

1. Navigate to the Audit section.
2. Specify a custom date range (or preset period).
3. Generate/request the audit.

**Expected Result:** The resulting audit only includes data within the specified time period or date range.

## Admin — Billing

### TC-034 — Subscribe to a plan

**Steps:**

1. Navigate to Billing.
2. Select a plan and complete the subscription flow, including payment details.

**Expected Result:** The admin is successfully subscribed to the selected plan and gains access to the plan's features.

### TC-035 — Switching plans requires confirmation

**Steps:**

1. While subscribed to a plan, select a different plan to switch to.
2. Attempt to complete the switch.

**Expected Result:** A confirmation step (e.g. modal/dialog) is presented before the switch is finalized; the switch does not occur until confirmed.

### TC-036 — Update or pause a plan

**Steps:**

1. Navigate to Billing.
2. Update the current plan's details (e.g. seats, tier).
3. Pause the plan instead.

**Expected Result:** Plan updates are saved correctly; pausing the plan suspends billing/access as expected and is clearly reflected in the UI.

### TC-037 — Cancelled plans cannot be cancelled again

**Steps:**

1. Cancel an active plan, confirming the cancellation.
2. Return to the billing page and check whether a 'Cancel' action is still available for the already-cancelled plan.

**Expected Result:** Once a plan is cancelled, the cancel action is no longer presented (state reflects the cancellation) and cannot be triggered a second time.

### TC-038 — Invoices are accurate

**Steps:**

1. Navigate to invoices within Billing.
2. Review a generated invoice against the actual plan cost, taxes, and any prorations.

**Expected Result:** Invoice amounts, dates, and line items accurately reflect the actual charges.

### TC-039 — Billing history is accurate

**Steps:**

1. Navigate to Billing History.
2. Cross-check listed transactions against actual account activity (subscriptions, changes, cancellations).

**Expected Result:** Billing history accurately and completely reflects all past billing events in the correct order.

### TC-040 — Payment method visible and can be updated

**Steps:**

1. Navigate to Billing.
2. View the current payment method on file.
3. Update it to a new payment method and save.

**Expected Result:** The current payment method is clearly visible; updating it succeeds and subsequent charges use the new method.

### TC-041 — Subscription state change triggers appropriate gates

**Steps:**

1. Downgrade, pause, or cancel a subscription.
2. Attempt to create a course.
3. Attempt to assign a course.
4. Attempt to run an audit.
5. Attempt to have staff access the learning portal.

**Expected Result:** Each gated area (course creation, course assigning, audits, staff learning-portal access) correctly restricts or allows access based on the current subscription state.

## Admin — RBAC (Role-Based Access Control)

### TC-042 — Each role has access only to its defined permissions

**Steps:**

1. Log in as a user with a specific role.
2. Attempt to access modules/features both within and outside the role's defined permissions.

**Expected Result:** The user can access only what their role permits; any attempt to access out-of-scope areas is blocked with an appropriate message.

### TC-043 — CRUD permissions work correctly within accessible modules

**Steps:**

1. Log in as a user with a specific role.
2. For each module the role has access to, attempt Create, Read, Update, and Delete actions as permitted.

**Expected Result:** Only the CRUD operations explicitly permitted for that role succeed; disallowed operations are blocked.

### TC-044 — Each role tested individually and in detail

**Steps:**

1. For every defined role in the system, repeat the permission and CRUD checks above in isolation.
2. Document findings per role.

**Expected Result:** Every role has been individually verified against its permission set with no gaps or unexpected access.

## Worker Side

### TC-045 — Admin can access worker/learner view

**Steps:**

1. Log in as an admin.
2. Switch to or open the worker/learner view.

**Expected Result:** The admin can view the learner portal as a worker would see it, without needing a separate worker account.

### TC-046 — Worker enters learner portal via invite

**Steps:**

1. As a worker, receive an invite email.
2. Click the invite link.

**Expected Result:** The worker is taken directly into the learner portal onboarding/view.

### TC-047 — Worker sets personal details and password during onboarding

**Steps:**

1. Accept a worker invite.
2. Enter personal details (name, contact info, etc.).
3. Set a password.
4. Complete onboarding.

**Expected Result:** Personal details and password are saved correctly, and the worker can subsequently log in with the new password.

### TC-048 — Worker can view assigned courses

**Steps:**

1. Log in as a worker with assigned courses.
2. Navigate to the courses view.

**Expected Result:** All courses assigned to the worker are listed accurately.

### TC-049 — Worker can view course material and take assessment

**Steps:**

1. Open an assigned course.
2. Review the course material.
3. Begin and complete the associated assessment.

**Expected Result:** Course material displays correctly, and the assessment can be started and completed without errors.

### TC-050 — Worker certificate issued after attestation

**Steps:**

1. Complete a course and its assessment successfully.
2. Complete any required attestation step.

**Expected Result:** A certificate is issued to the worker immediately after attestation and is accessible on their profile.

### TC-051 — Failed quiz can be retaken up to configured limit

**Steps:**

1. Fail a quiz/assessment.
2. Retake it, tracking the number of attempts against the configured retake limit.

**Expected Result:** The worker can retake the quiz exactly the number of times configured for that assessment, no more and no less.

### TC-052 — Quiz is gated after reaching fail limit

**Steps:**

1. Fail a quiz the maximum configured number of times.
2. Attempt to retake it again.

**Expected Result:** The quiz becomes gated/locked once the fail limit is reached, preventing further attempts until intervention.

### TC-053 — Admin alerted when worker reaches quiz fail limit

**Steps:**

1. Cause a worker to reach the fail limit on a quiz.
2. Check for a notification/alert to the admin.

**Expected Result:** The admin receives an alert when a worker reaches the fail limit for a quiz.

### TC-054 — Admin can reassign gated quiz to worker

**Steps:**

1. With a worker's quiz gated due to reaching the fail limit, log in as admin.
2. Reassign the quiz to that worker.

**Expected Result:** The quiz becomes available to the worker again after being reassigned by the admin.

### TC-055 — Worker can view assessment details after completion

**Steps:**

1. Complete an assessment.
2. Navigate to view the completed assessment's details (score, answers, feedback if applicable).

**Expected Result:** Assessment details are accurately displayed to the worker after completion.

### TC-056 — Worker can view profile and grades

**Steps:**

1. Log in as a worker.
2. Navigate to their profile and grades section.

**Expected Result:** The worker's profile and grades display accurately and completely.

### TC-057 — Worker can edit profile

**Steps:**

1. Log in as a worker.
2. Navigate to profile settings.
3. Edit editable fields and save.

**Expected Result:** Changes are saved successfully and reflected immediately in the worker's profile.

## Platform-Wide — Two-Factor Authentication (2FA)

### TC-058 — Enable 2FA on account

*Inferred — no bullets provided in source; baseline coverage.*

**Steps:**

1. Navigate to security settings.
2. Enable 2FA and complete setup (e.g. authenticator app or SMS).

**Expected Result:** 2FA is enabled successfully, and the user is prompted for a second factor on subsequent logins.

### TC-059 — Login requires correct 2FA code

*Inferred — no bullets provided in source; baseline coverage.*

**Steps:**

1. Log in with valid credentials.
2. Enter an incorrect 2FA code.
3. Enter the correct 2FA code.

**Expected Result:** Login is blocked with an incorrect code and clear error messaging; login succeeds only with the correct code.

### TC-060 — Disable 2FA

*Inferred — no bullets provided in source; baseline coverage.*

**Steps:**

1. Navigate to security settings with 2FA enabled.
2. Disable 2FA, confirming identity if prompted.

**Expected Result:** 2FA is disabled successfully and subsequent logins no longer require a second factor.

## Platform-Wide — Session Timeout

### TC-061 — Session expires after inactivity period

*Inferred — no bullets provided in source; baseline coverage.*

**Steps:**

1. Log in and remain inactive for the configured timeout duration.

**Expected Result:** The session expires automatically and the user is redirected to the login page, with any warning shown beforehand if applicable.

### TC-062 — Activity resets the timeout timer

*Inferred — no bullets provided in source; baseline coverage.*

**Steps:**

1. Log in and interact with the app periodically, staying under the timeout threshold each time.

**Expected Result:** The session remains active as long as the user interacts within the timeout window, and does not expire prematurely.

## Platform-Wide — Help Center

### TC-063 — Help Center is accessible and content is legible

*Copy-quality check per source instruction: 'ensure copies are legible, coherent and relate to the page they are on.'*

**Steps:**

1. Navigate to the Help Center from any page.
2. Open an article.

**Expected Result:** The Help Center loads correctly; all copy is legible, coherent, and relevant to the page/context the user came from.

### TC-064 — Help Center search returns relevant results

**Steps:**

1. Navigate to the Help Center.
2. Search using a relevant keyword.

**Expected Result:** Search returns relevant, accurate results related to the query.

## Platform-Wide — Settings

### TC-065 — Settings page content is legible and relevant

*Copy-quality check per source instruction: 'ensure copies are legible, coherent and relate to the page they are on.'*

**Steps:**

1. Navigate to Settings.
2. Review all labels, descriptions, and helper text on the page.

**Expected Result:** All copy is legible, coherent, and relates directly to the settings on that page.

### TC-066 — Settings changes are saved correctly

**Steps:**

1. Change a setting.
2. Save and refresh/reload the page.

**Expected Result:** The changed setting persists after save and reload, and the UI reflects the new state (e.g. a toggled-off option no longer shows as active).

## Platform-Wide — Profile Editing

### TC-067 — Edit and save profile details

**Steps:**

1. Navigate to profile settings.
2. Edit fields such as name, contact info, or avatar.
3. Save changes.

**Expected Result:** Changes are saved successfully and reflected immediately across the app.

### TC-068 — Validation errors shown for invalid profile input

**Steps:**

1. Attempt to save the profile with invalid input (e.g. malformed email, empty required field).

**Expected Result:** A clear validation error is shown and the invalid change is not saved.

## Platform-Wide — Logging Out

### TC-069 — User can log out successfully

**Steps:**

1. While logged in, select 'Log Out'.

**Expected Result:** The session is terminated and the user is redirected to the login page.

### TC-070 — Logged-out session cannot access protected pages

**Steps:**

1. Log out.
2. Attempt to navigate directly (e.g. via URL) to a page that requires authentication.

**Expected Result:** The user is redirected to the login page and cannot view protected content.
