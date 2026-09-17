---
name: authorship-is-not-ownership
description: A `createdByOrgUserId === me` condition on a read gate looks like a narrowing but silently revokes granted permissions; the two quiz-result surfaces are the worked example
metadata:
  type: feedback
---

**An authorship condition (`row.createdByOrgUserId === session.user.organizationUserId`) is not a tenancy check and must not be left standing next to one.** Where a read needs narrowing, the predicate is ownership of the RECORD — the caller's organisation, plus facility scope — not who happened to author the thing the record points at.

**Why:** `getEnrollmentWithResults` (`src/app/actions/enrollment.ts`) kept authorship as a fourth condition during a security phase, on the reasoning that removing it would "widen access". It closed nothing the org + facility checks did not already close (both sides of the comparison are the caller's own membership id, so cross-tenant could never match anyway), and it quietly revoked founder ruling Q6: HR holds `assessment.read` but authors almost no courses — an adopted video course is authored by Theraptly, a colleague's reading course by that colleague — so HR held the grant and was refused every real results page. Staging QA 2026-09-17 (ISSUE-4) proved it with a positive control: Owner 200s where HR 404s on the identical URL, the only difference being authorship. Fixed on `fix/qa-release-defects`.

**How to apply:**
- When two surfaces expose the SAME payload, their gates must agree. `getEnrollmentQuizResult` (`src/app/actions/staff.ts`) had always been `isAdminRole` + `assessment.read` + org + facility with no authorship; that disagreement was the bug's fingerprint. Diff the siblings before trusting either.
- A test that satisfies authorship while probing something else re-passes for the wrong reason. The regression test must put the caller on a record they did **not** author (`setNonAuthorSession` in `enrollment.quiz-result-scope.test.ts`) — mutation-check by restoring `!isCourseCreator` and confirming it reddens.
- The `isAdminRole && can(roleKey, 'assessment.read')` conjunction stays: that action uses the tier-less `resolveSession()`, and every worker role holds `assessment.read` for its own attempt. See [[gotcha_course_read_is_not_admin_only]] for the identical shape on `course.read`.
- Same trap, opposite direction: `getCourseById`'s archive rule deliberately gives authorship NO exemption either — see [[project_archive_filter_and_raw_prisma]].

Related: [[gotcha_rbac_actor_lists_vs_permissions]], [[gotcha_assignment_action_authorization_split]].
