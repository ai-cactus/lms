## 2025-03-17 - [Missing Database Indexes for Dashboard Queries]
**Learning:** The dashboard and training pages perform frequent filtering queries against `Course.createdBy`, `Enrollment.courseId` (for joins and filtering), and `Notification.userId` (for header polling). However, the `prisma/schema.prisma` file is missing indexes for these fields. This is a common pattern where nested relation queries or frequent polling on un-indexed foreign keys can cause slow full table scans as data grows.
**Action:** Always verify foreign keys and frequently queried fields in `schema.prisma` have the appropriate `@@index` decorators, especially when used in dashboard analytics or layout polling.

## 2025-03-17 - [Unused Code in DashboardCharts.tsx]
**Learning:** During a code health task to remove an unused `Button` import in `src/components/dashboard/DashboardCharts.tsx` (which had already been removed), it was noticed that the `COLORS` object and `truncateLabel` function are currently defined but unused in the file.
**Action:** Log a future task to review, test, and potentially remove the `COLORS` object and `truncateLabel` function in `src/components/dashboard/DashboardCharts.tsx` to improve code maintainability.

## 2024-03-18 - [Prisma N+1 and Redundant Query Opt]
**Learning:** Found a pattern where data returned implicitly by Prisma `include` is re-queried explicitly in a separate query (e.g. `courses.include({ enrollments: true })` followed by `enrollments.findMany()`). This creates a complete N+1 anti-pattern via redundant `Promise.all` fetching that wastes database connections and compute.
**Action:** Always inspect the full return shape of existing Prisma queries in a module before initiating a new query. If the data is already eager-loaded via `include`, use JS transformations (e.g., `.flatMap()`) on the application server rather than making a second database trip.

## 2025-03-22 - [Merge Dashboard Data Queries]
**Learning:** Found an anti-pattern in `src/app/dashboard/(main)/page.tsx` and `src/app/dashboard/(main)/training/page.tsx` where both `getCourses()` and `getDashboardStats()` were called in parallel. Both queried the database for all `course` objects and associated `enrollments` + `lessons` using `prisma.course.findMany()`, resulting in a redundant database request (Prisma N+1 / redundant query anti-pattern).
**Action:** Replaced both calls with a single `getDashboardData()` query that returns `{ courses, stats }` in one pass, slicing database queries in half for dashboard rendering.

