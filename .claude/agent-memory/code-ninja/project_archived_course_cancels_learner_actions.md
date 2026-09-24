---
name: project_archived_course_cancels_learner_actions
description: Founder Q-04/Q-05/Q-06 (2026-09-23) made archiving a CANCELLATION — 11 learner write paths refuse, 2 reminder tracks skip, certificates deliberately do NOT; the learner lists keep the row and mark it Cancelled
metadata:
  type: project
---

Archiving a course used to be read-side only (Q24: hide it from every list, keep
the record). Founder rulings on **2026-09-23** narrowed that:

- **Q-05** — archiving is allowed and is NEVER blocked by live enrolments; the
  active learners must be **notified the course is cancelled** and must not be
  able to continue it.
- **Q-04** — an archived course cannot be retaken. All learner actions stop:
  access, quizzes, attestation. **Certificates already earned are retained.**
- **Q-06** — no reminders for archived courses.

**Why:** a retired course was still accumulating obligations and still mailing
"your training is overdue" about something nobody could clear.

**How to apply.**

**The archive filter is a query extension on TOP-LEVEL Course reads only.** Every
learner path reaches the course through a NESTED include (`Enrollment.course`,
`QuizAttempt.enrollment.course`, `Lesson.course`), which the extension cannot
touch — that is exactly why each of these had to state the rule itself. Adding a
new learner write path? It will silently accept an archived course unless you
say otherwise.

Refusal copy is shared from **`src/lib/course/archived.ts`** (pure, no Prisma, so
client code can import it). Use `ARCHIVED_COURSE_LEARNER_MESSAGE`,
`ARCHIVED_COURSE_ADMIN_MESSAGE`, `ARCHIVED_COURSE_ERROR_CODE`. Note
`enrollment.ts` keeps its own module-private `ARCHIVED_ASSIGN_MESSAGE` for the
role-widen refusal — a `'use server'` file may only export async functions, which
is why the shared constants live outside one.

**Certificates are the deliberate NON-gate.** `issueCertificate` has no archive
predicate and must not gain one: it only materialises a certificate for an
enrolment that already reached `completed`/`attested`, and since attestation and
quiz submission are now both refused, such an enrolment can only have got there
BEFORE the archive. Gating it would confiscate an earned certificate, not prevent
a new one. Every certificate READ path reaches Course through a nested relation
too, so an archived course's certificate keeps resolving its title. Pinned in
`src/app/actions/certificate.test.ts`.

**Tier choice for the cancellation notice.** The catalog's `tier` table
(`ENGINE_EVENTS`) governs `emitNotificationEvent`, which resolves recipients from
ROLES. This notice is addressed to named learners, so it uses the learner funnel
(`createNotification`-shaped, instant at commit) like `COURSE_ASSIGNED` and
`RETAKE_ASSIGNED` — `emitNotificationEvent` simply cannot address it. Instant is
also right on the merits: batching a cancellation into the next cycle summary
leaves the learner pushing at a course the server already refuses.
`src/lib/course/notify-archived.ts` batches (`createMany`) rather than looping
`createNotification`, because a mandatory course can carry hundreds of enrolments
behind a Server Action an admin is waiting on. "Active learner" = every enrolment
short of `attested`, held by an active member.

**Two tests pinned the OLD ruling and were inverted, with dated SUPERSEDED
comments** — `get-learn-payload.test.ts` ("still serves an ARCHIVED course to the
worker already enrolled in it") and `course.archive-visibility.test.ts`
("ISSUE-3: an enrolled worker still opens a course that was archived under
them"). Both were deliberate, both are now the opposite.

**The list seam, ruled 2026-09-24 — option (b): KEEP the row, mark it
"Cancelled", disable the action.** Filtering archived courses out of
`prisma.enrollment.findMany` on `/worker` and `/worker/trainings` was rejected:
it would also erase the learner's archived COMPLETED rows from their own history.
Instead both pages carry `courseArchived: picked.course.archivedAt !== null` on
`LearnerCourseRow`, and the two learner lists render it:
`WorkerCourseList` swaps the status badge for `CancelledCourseBadge`, disables
the primary action, makes the row unclickable and withdraws every kebab action
except "Download certificate"; `WorkerTrainingList`'s Completed-tab cards do the
same to "View Result".

Two consequences worth keeping in mind:

- **Disabled, never hidden.** A missing button reads as a rendering bug; a
  disabled one next to a "Cancelled" badge reads as a decision. The shared
  `ARCHIVED_COURSE_LEARNER_MESSAGE` is the disabled control's `title`.
- **`WorkerWelcomeModal` had the same dead end** and is fed from the same page:
  its "Start your first course" pushes straight to `/learn/<id>`, so `/worker`
  now passes it only the non-archived courses — with every course cancelled the
  modal stays shut rather than offering a 404.

The learner dashboard's metric tiles still COUNT a cancelled course in "Total
courses" / "Completed"; no ruling was made on that, so it was left alone.

**Video playback revocation is not instant:** `/api/video/[lessonId]` evaluates
`archivedAt` off the in-process meta cache (60 s TTL), so an archive landing
mid-playback takes effect within a minute. Same trade the route already accepts
for unenrollment; documented in `playback-cache.ts`.

Related: [[archive-filter-and-raw-prisma]],
[[gotcha_server_action_refusals_must_return]],
[[gotcha_quiz_route_error_body_shapes]], [[gotcha_sweep_test_mock_queue_coupling]].
