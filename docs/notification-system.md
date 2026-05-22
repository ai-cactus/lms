# Notification System Documentation

> **Last Updated:** April 17, 2026

## Overview

The LMS notification system provides in-app notifications to both **Admins** and **Workers**. Notifications are stored in the database via the `Notification` Prisma model and displayed in a bell-icon dropdown in the respective dashboard headers.

---

## Data Model

**`Notification`** — defined in [`prisma/schema.prisma`](../prisma/schema.prisma)

| Field        | Type      | Description                                      |
|-------------|-----------|--------------------------------------------------|
| `id`        | `String`  | UUID primary key                                  |
| `userId`    | `String`  | FK to the `User` who receives the notification    |
| `type`      | `String`  | Notification type identifier (e.g. `COURSE_ASSIGNED`) |
| `title`     | `String`  | Short headline                                    |
| `message`   | `String`  | Detailed body text                                |
| `isRead`    | `Boolean` | Whether the user has read it (default: `false`)   |
| `linkUrl`   | `String?` | Optional URL to navigate to when clicked          |
| `metadata`  | `Json?`   | Arbitrary JSON data (e.g. `courseId`, `enrollmentId`) |
| `createdAt` | `DateTime`| Auto-set creation timestamp                       |
| `resolvedAt`| `DateTime?`| Set when the notification is actioned/resolved   |

---

## Server Actions

Defined in [`src/app/actions/notifications.ts`](../src/app/actions/notifications.ts)

| Function                      | Purpose                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| `getNotifications()`          | Fetches up to 50 most recent notifications for the logged-in user. Works for both admin and worker sessions. Returns `{ notifications, unreadCount }`. |
| `markAsRead(notificationId)`  | Marks a single notification as read (scoped to the current user).       |
| `markAllAsRead()`             | Marks all unread notifications as read for the current user.            |
| `createNotification(data)`    | Internal helper — creates a notification for a specific user. Failures are silently caught to avoid disrupting the main flow. |
| `notifyOrganizationAdmins(orgId, data)` | Creates a notification for **all users with role `admin`** in the given organization. |

---

## UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| Admin Header | [`src/components/dashboard/Header.tsx`](../src/components/dashboard/Header.tsx) | Bell icon with unread badge, dropdown list, mark-as-read and mark-all-as-read |
| Worker Header | [`src/components/worker/WorkerHeader.tsx`](../src/components/worker/WorkerHeader.tsx) | Same bell/dropdown pattern for the worker dashboard |

Notifications are fetched on component mount via `useEffect` (no real-time/WebSocket updates).

---

## Notification Types & Trigger Points

### Summary Table

| # | Type | Trigger Event | Recipient | Source File | Link URL |
|---|------|--------------|-----------|-------------|----------|
| 1 | `COURSE_ASSIGNED` | Admin assigns a course to a worker | **Worker** | [`enrollment.ts:166`](../src/app/actions/enrollment.ts) | `/worker/trainings` |
| 2 | `COURSE_PASSED` | Worker completes and attests to a course | **Org Admins** | [`course.ts:803`](../src/app/actions/course.ts) | `/dashboard/staff/{userId}` |
| 3 | `COURSE_FAILED` | Worker fails a quiz | **Org Admins** | [`enrollment.ts:346`](../src/app/actions/enrollment.ts) | `/dashboard/staff/{userId}` |
| 4 | `COURSE_RETRY_REQUESTED` | Worker requests a retry for a failed course | **Org Admins** | [`enrollment.ts:410`](../src/app/actions/enrollment.ts) | `/dashboard/staff/{userId}` |
| 5 | `QUIZ_RETRY_LIMIT_REACHED` | Worker exhausts all quiz attempts (enrollment locked) | **Org Admins** | [`quiz/submit/route.ts:259`](../src/app/api/quiz/[id]/submit/route.ts) | `/dashboard/staff/{userId}` |
| 6 | `RETAKE_ASSIGNED` | Admin assigns a retake for a locked enrollment | **Worker** | [`course.ts:1064`](../src/app/actions/course.ts) | `/learn/{courseId}` |
| 7 | `WELCOME` | Worker joins an organization via invite code | **Worker** | [`organization-code.ts:164`](../src/app/actions/organization-code.ts) | *(none)* |
| 8 | `WORKER_JOINED` | Worker joins an organization via invite code | **Org Admins** | [`organization-code.ts:177`](../src/app/actions/organization-code.ts) | `/dashboard/staff/{userId}` |

---

### Detailed Descriptions

#### 1. `COURSE_ASSIGNED` — Worker

- **When:** An admin enrolls a worker in a course (creates an enrollment record).
- **Recipient:** The enrolled worker.
- **Message:** `"You have been assigned a new course: {course title}"`
- **Link:** `/worker/trainings`
- **Code:** [`src/app/actions/enrollment.ts`](../src/app/actions/enrollment.ts)

```
await createNotification({
  userId: user.id,
  type: 'COURSE_ASSIGNED',
  title: 'New Course Assigned',
  message: `You have been assigned a new course: ${course.title}`,
  linkUrl: '/worker/trainings',
  metadata: { courseId },
});
```

---

#### 2. `COURSE_PASSED` — Org Admins

- **When:** A worker completes a course and attests to it (passes the quiz and confirms completion).
- **Recipient:** All organization admins.
- **Message:** `"{worker name} has completed and attested to the course: {course title}."`
- **Link:** `/dashboard/staff/{userId}`
- **Code:** [`src/app/actions/course.ts`](../src/app/actions/course.ts)

```
await notifyOrganizationAdmins(enrollment.user.organizationId, {
  type: 'COURSE_PASSED',
  title: 'Course Completed',
  message: `${name} has completed and attested to the course: ${courseTitle}.`,
  linkUrl: `/dashboard/staff/${enrollment.user.id}`,
  metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
});
```

---

#### 3. `COURSE_FAILED` — Org Admins

- **When:** A worker fails a quiz.
- **Recipient:** All organization admins.
- **Message:** `"{worker name} has failed the quiz for course: {course title}."`
- **Link:** `/dashboard/staff/{userId}`
- **Code:** [`src/app/actions/enrollment.ts`](../src/app/actions/enrollment.ts)

```
await notifyOrganizationAdmins(user.organizationId, {
  type: 'COURSE_FAILED',
  title: 'Quiz Failed',
  message: `${name} has failed the quiz for course: ${courseTitle}.`,
  linkUrl: `/dashboard/staff/${user.id}`,
  metadata: { userId: user.id, courseId: enrollment.courseId, score },
});
```

---

#### 4. `COURSE_RETRY_REQUESTED` — Org Admins

- **When:** A worker requests a retry for a failed course.
- **Recipient:** All organization admins.
- **Message:** `"{worker name} has requested a retry for the course: {course title}."`
- **Link:** `/dashboard/staff/{userId}`
- **Code:** [`src/app/actions/enrollment.ts`](../src/app/actions/enrollment.ts)

```
await notifyOrganizationAdmins(enrollment.user.organizationId, {
  type: 'COURSE_RETRY_REQUESTED',
  title: 'Course Retry Requested',
  message: `${name} has requested a retry for the course: ${courseTitle}.`,
  linkUrl: `/dashboard/staff/${enrollment.user.id}`,
  metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
});
```

---

#### 5. `QUIZ_RETRY_LIMIT_REACHED` — Org Admins

- **When:** A worker exhausts all allowed quiz attempts. The enrollment status is set to `locked`.
- **Recipient:** All organization admins.
- **Message:** `"{worker name} has used all {attempt count} attempts on \"{quiz title}\" in course \"{course name}\" and requires a retake assignment."`
- **Link:** `/dashboard/staff/{userId}`
- **Deduplication:** Only one unresolved notification per enrollment. Before creating, the system checks for an existing `QUIZ_RETRY_LIMIT_REACHED` notification with `resolvedAt: null` and matching `enrollmentId` in metadata.
- **Code:** [`src/app/api/quiz/[id]/submit/route.ts`](../src/app/api/quiz/[id]/submit/route.ts)

```
const existingNotification = await prisma.notification.findFirst({
  where: {
    type: 'QUIZ_RETRY_LIMIT_REACHED',
    resolvedAt: null,
    metadata: { path: ['enrollmentId'], equals: enrollmentId },
  },
});

if (!existingNotification) {
  await prisma.notification.createMany({
    data: admins.map((admin) => ({ ... })),
  });
}
```

---

#### 6. `RETAKE_ASSIGNED` — Worker

- **When:** An admin assigns a retake for a locked enrollment.
- **Recipient:** The worker whose enrollment was locked.
- **Message:** `"An admin has assigned you a retake for \"{course title}\". You can now take the quiz again."`
- **Link:** `/learn/{courseId}`
- **Side effect:** Resolves (sets `resolvedAt` and `isRead: true`) any existing `QUIZ_RETRY_LIMIT_REACHED` and `COURSE_RETRY_REQUESTED` notifications for that enrollment.
- **Code:** [`src/app/actions/course.ts`](../src/app/actions/course.ts)

```
// Resolve existing notifications
await prisma.notification.updateMany({
  where: {
    type: { in: ['QUIZ_RETRY_LIMIT_REACHED', 'COURSE_RETRY_REQUESTED'] },
    resolvedAt: null,
    metadata: { path: ['enrollmentId'], equals: enrollmentId },
  },
  data: { resolvedAt: new Date(), isRead: true },
});

// Notify the worker
await createNotification({
  userId: lockedEnrollment.userId,
  type: 'RETAKE_ASSIGNED',
  title: 'Retake Assigned',
  message: `An admin has assigned you a retake for "${lockedEnrollment.course.title}". You can now take the quiz again.`,
  linkUrl: `/learn/${lockedEnrollment.courseId}`,
  metadata: { enrollmentId, courseId, parentEnrollmentId },
});
```

---

#### 7. `WELCOME` — Worker

- **When:** A worker joins an organization using an invite code.
- **Recipient:** The worker.
- **Message:** `"You have successfully joined the organization. Your training will appear here when assigned."`
- **Link:** *(none)*
- **Code:** [`src/app/actions/organization-code.ts`](../src/app/actions/organization-code.ts)

```
await createNotification({
  userId: userId,
  type: 'WELCOME',
  title: `Welcome to ${organizationName}`,
  message: 'You have successfully joined the organization. Your training will appear here when assigned.',
});
```

---

#### 8. `WORKER_JOINED` — Org Admins

- **When:** A worker joins an organization using an invite code.
- **Recipient:** All organization admins.
- **Message:** `"{worker name} has joined your organization using the invite code."`
- **Link:** `/dashboard/staff/{userId}`
- **Code:** [`src/app/actions/organization-code.ts`](../src/app/actions/organization-code.ts)

```
await notifyOrganizationAdmins(orgId, {
  type: 'WORKER_JOINED',
  title: 'New Member Joined',
  message: `${name} has joined your organization using the invite code.`,
  linkUrl: `/dashboard/staff/${userId}`,
  metadata: { userId },
});
```

---

## Notification Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        TRIGGERS                                  │
├──────────────────────────┬──────────────────────────────────────┤
│      Worker Actions      │         Admin Actions                │
├──────────────────────────┼──────────────────────────────────────┤
│ • Joins org (invite code)│ • Assigns course to worker           │
│ • Completes course       │ • Assigns retake for locked enroll.  │
│ • Fails quiz             │                                      │
│ • Requests retry         │                                      │
│ • Exhausts quiz attempts │                                      │
└──────────┬───────────────┴──────────────┬───────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────────┐
│   Worker receives:  │      │   Admin(s) receive:     │
│ • WELCOME           │      │ • COURSE_PASSED         │
│ • COURSE_ASSIGNED   │      │ • COURSE_FAILED         │
│ • RETAKE_ASSIGNED   │      │ • COURSE_RETRY_REQUESTED│
│                     │      │ • QUIZ_RETRY_LIMIT_...  │
│                     │      │ • WORKER_JOINED         │
└─────────────────────┘      └─────────────────────────┘
```

---

## Behavioral Notes

1. **In-app only:** Notifications are displayed in the dashboard header dropdown. There is no push notification, email, or real-time (WebSocket) delivery — they are fetched via `useEffect` on component mount.

2. **Silent failure:** `createNotification()` and `notifyOrganizationAdmins()` catch errors internally and never throw, so a notification failure will never disrupt the main business operation (e.g., course assignment still succeeds even if the notification fails).

3. **Deduplication:** `QUIZ_RETRY_LIMIT_REACHED` notifications are deduplicated per enrollment — only one unresolved notification exists at a time.

4. **Auto-resolution:** When a retake is assigned, the system automatically resolves related `QUIZ_RETRY_LIMIT_REACHED` and `COURSE_RETRY_REQUESTED` notifications by setting `resolvedAt` and `isRead: true`.

5. **Performance cap:** `getNotifications()` limits results to the 50 most recent notifications per user.

6. **Dual auth support:** The `resolveSession()` helper in [`notifications.ts`](../src/app/actions/notifications.ts) checks both admin and worker auth instances, so a single codebase serves both user roles.
