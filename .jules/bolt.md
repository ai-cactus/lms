## 2025-03-17 - [Missing Database Indexes for Dashboard Queries]
**Learning:** The dashboard and training pages perform frequent filtering queries against `Course.createdBy`, `Enrollment.courseId` (for joins and filtering), and `Notification.userId` (for header polling). However, the `prisma/schema.prisma` file is missing indexes for these fields. This is a common pattern where nested relation queries or frequent polling on un-indexed foreign keys can cause slow full table scans as data grows.
**Action:** Always verify foreign keys and frequently queried fields in `schema.prisma` have the appropriate `@@index` decorators, especially when used in dashboard analytics or layout polling.

## 2025-03-17 - [Unused Code in DashboardCharts.tsx]
**Learning:** During a code health task to remove an unused `Button` import in `src/components/dashboard/DashboardCharts.tsx` (which had already been removed), it was noticed that the `COLORS` object and `truncateLabel` function are currently defined but unused in the file.
**Action:** Log a future task to review, test, and potentially remove the `COLORS` object and `truncateLabel` function in `src/components/dashboard/DashboardCharts.tsx` to improve code maintainability.
