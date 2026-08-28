---
name: project-courses-video-reading-consolidation
description: /dashboard/courses lost its outer My Courses / Available Video Courses tabs — the global video catalog is merged into the Video tab; Video is the landing tab unless the org's content is reading-only
metadata:
  type: project
---

`/dashboard/courses` renders **only** `CoursesListClient`'s Video / Reading Course tabs.
`CoursesPageTabs.tsx` and `AvailableCoursesClient.tsx` are deleted.

**Why:** product ruling 2026-08-10, re-confirmed 2026-08-27 — every organization owns every
video course from creation, so an "available / adopt" step is friction, not a feature.
`OrgCourseOffering` survives as internal bookkeeping (rows + per-org custom titles kept, no
migration); only the adoption *UI* went.

**How to apply:**

- The two lists were different sets. `getCourses()` returns own + *adopted* courses; the old
  Available tab returned the whole global catalog. A published global video course with no
  offering row was in one and not the other. The union is done **in the page**, not inside
  `getCourses`, deliberately: `getCourses` also feeds `AssignCoursesModal` and
  `ConfirmPublishModal`, and `assignCourseToUsers` rejects any course whose
  `creator.organizationId` is not the caller's org — widening `getCourses` would have put
  courses into assignment pickers that the assign action then refuses. See
  [[gotcha_assignment_action_authorization_split]].
- `listGlobalVideoCatalogCourses()` (in `offering.ts`) is the catalog→`CourseWithStats`
  projection. It rides the existing `unstable_cache`'d, tenant-independent
  `getGlobalVideoCatalog()` read, which was widened with the course-table columns; timestamps
  are stored as **ISO strings** there because that payload round-trips the cache serializer.
  Any test that mocks `prisma.course.findMany` for this catalog must supply `createdAt`,
  `updatedAt`, `status`, `thumbnail`, `duration` and `_count.lessons` or the mapper throws.
- Catalog rows carry `isGlobalCatalog: true` on `CourseWithStats` and get **no row-actions
  menu**: rename/delete would mutate a course every tenant shares, and assign is refused by
  the creator-org check above.
- Availability is gated on `hasActiveBilling()` (no tier mapping) — the page's already-computed
  `hasBilling` decides whether the catalog read runs at all.

**Landing tab (corrected 2026-08-28).** Video is the landing tab *unless every course the org
has is non-video*, in which case it opens on Reading Course:
`courses.length > 0 && courses.every((c) => c.type !== 'video') ? 'slides' : 'video'`, read
**once** as a `useState` initialiser so a later `courses` change does not yank the user out of
a tab they opened. An earlier version of this note said the default was *unconditional* and
that the reading-only fallback was gone — that is no longer true of the code.
Consequence: the e2e breakage this note used to predict (seed's only course
`E2E Compliance Training` is `type: 'text'`, so `goto('/dashboard/courses')` +
`getByText(SEEDED_COURSE_TITLE).click()` lands on an empty Video tab) **needs re-verifying**
before being trusted — with the fallback in place a reading-only seed should land on Reading
Course already. `tests/e2e/reminders.spec.ts` (6 places) and `tests/e2e/course.spec.ts`
ENG-022 are the specs to check. `COURSE_TYPE_BY_TAB` maps `slides` -> `'text'`.

**Orphan cleanup (done 2026-08-28).** `VideoCourseCard.tsx` + its test, the
`listAvailableVideoCourses` server action + its `describe` block, and `VideoCourseAvailabilityRow`
are all **deleted**. Two things to carry forward:

- Deleting that `describe` took the only unit assertions on `getGlobalVideoCatalog`'s query
  shape (`type: 'video'`, `isGlobal: true`, `status: 'published'`, `orderBy createdAt asc`,
  no `organizationId`) and on `resolveOrg`'s guards for that path. Its surviving caller
  `listGlobalVideoCatalogCourses` has **no** direct unit test — the Courses page test mocks it
  wholesale. Real coverage gap; bug-hunter's to close.
- `GlobalVideoCatalogRow` still computes `category`, `durationSeconds`, `questionCount` and
  `hasPoster`, which **nothing reads** now — they fed the deleted card. Removing them also
  narrows the cached Prisma `select` (`lessons`, `previewPosterStorageUri`), so it is a
  behaviour-affecting change, not cleanup; left in place with a comment saying so.

Still deliberately alive: `/dashboard/courses/prebuilt`, linked from `Step1Category.tsx` and
`CoursesListClient.tsx`. Not dead — removing it is a product change.
