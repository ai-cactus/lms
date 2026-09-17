---
name: auditor-catalogue-lockstep
description: The audit-report screen and the export worker must filter courses identically; they now share auditorCatalogueWhere — and archived ≠ draft ≠ inactive on this path
metadata:
  type: project
---

Four surfaces read the org's course catalogue for audit reporting, and they must
agree exactly or the auditor reads one number on screen and a different one in the
PDF they downloaded (the defect #632 closed):

- `getAuditorOverviewStats` + `getAuditorCourses` (`src/app/actions/auditor.ts`)
- the export worker's `course` / `all-courses` / `all-staff` / `org` branches
  (`src/lib/queue/auditor-export-worker.ts`)
- `POST /api/auditor/export/start`'s single-course validation

They all build from one predicate, `auditorCatalogueWhere`
(`src/lib/audit-reports/catalogue-scope.ts`). Do not inline a status or tenancy
filter at any one of them.

**Why:** three *different* course-exclusion concepts collide here and get conflated:

| concept | column | auditor path |
|---|---|---|
| `draft` | `status` | EXCLUDED (maintainer ruling, 2026-09-17, reversing the earlier "spans every status" ruling) |
| `inactive` / retired | `status` | KEPT — it was in service, its records are evidence |
| archived | `archivedAt` | KEPT — which is why these callers read Course off `rawPrisma`, bypassing the `db/index.ts` query extension (Q24) |

**How to apply:** a change to what an audit report counts lands in the shared
predicate, never at a call site. If you must special-case one surface, say out loud
which of the three concepts you mean. Related: [[project_archive-filter-and-raw-prisma]],
[[reference_figma_audit_reports]].
