---
name: server-action-args-are-unchecked
description: A closed TS type on a Server Action's `data` param does not bind the client — spreading it into prisma.update is mass assignment; pick fields at runtime
metadata:
  type: project
---

`updateCourse(courseId, data)` passed `data` straight to `prisma.course.update`. Its param type was closed (a
course-publish-gate test even pinned that with `@ts-expect-error`), but Server Action arguments are deserialized
from the client unchecked, so any caller could write `organizationId`, `status`, `approvedByOrgUserId`, …
Fixed in BUG-17 (2026-09-22) by picking title/description/duration explicitly, with a runtime test.

**Why:** the compile-time pin created false confidence — it only proves TypeScript callers can't widen it.

**How to apply:** in any `'use server'` function, never spread a caller-supplied object into a Prisma `data`.
Pick keys explicitly (or validate with a schema) and test with an over-wide payload cast through `unknown`.
Grep for `data,` / `data: input` / `...data` in src/app/actions when touching one. Related:
[[server-action-refusals-must-return]].
