import { describe, it, expect } from 'vitest';
import type { EnrollmentStatus } from '@/generated/prisma/enums';
import {
  ENROLLMENT_PHASE,
  FINISHED_ENROLLMENT_STATUSES,
  NOT_STARTED_ENROLLMENT_STATUSES,
  averageGrade,
  buildSnapshot,
  classifyCredential,
  computeFacilityRow,
  computeFacilityView,
  computeHeadline,
  countActiveCourses,
  countActiveLearners,
  daysAfter,
  daysBefore,
  dueSoonEnrollmentWhere,
  enrollmentGrades,
  firstAttemptOutcomes,
  isDormantMember,
  isDueSoon,
  isOverdue,
  isUnfinishedStatus,
  overdueEnrollmentWhere,
  previousStaffPopulationWhere,
  sliceSnapshot,
  staffPopulationWhere,
  type DashboardCertificate,
  type DashboardEnrollment,
  type DashboardMember,
  type DashboardQuizAttempt,
  type DashboardSlice,
} from './definitions';
import { ADMIN_ROLES, ALL_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';

const NOW = new Date('2026-09-27T12:00:00.000Z');

function member(overrides: Partial<DashboardMember> = {}): DashboardMember {
  return {
    id: 'm-1',
    role: 'nurse',
    joinedAt: daysBefore(NOW, 100),
    lastLoginAt: daysBefore(NOW, 1),
    facilityIds: ['fac-a'],
    ...overrides,
  };
}

function enrollment(overrides: Partial<DashboardEnrollment> = {}): DashboardEnrollment {
  return {
    id: 'e-1',
    organizationUserId: 'm-1',
    courseId: 'c-1',
    status: 'in_progress',
    startedAt: daysBefore(NOW, 3),
    accessAt: null,
    lastActivityAt: daysBefore(NOW, 1),
    dueAt: null,
    completedAt: null,
    retakeOf: null,
    ...overrides,
  };
}

function attempt(overrides: Partial<DashboardQuizAttempt> = {}): DashboardQuizAttempt {
  return {
    enrollmentId: 'e-1',
    quizId: 'q-1',
    score: 80,
    completedAt: daysBefore(NOW, 1),
    ...overrides,
  };
}

function certificate(overrides: Partial<DashboardCertificate> = {}): DashboardCertificate {
  return {
    id: 'cert-1',
    enrollmentId: 'e-1',
    organizationUserId: 'm-1',
    courseId: 'c-1',
    issuedAt: daysBefore(NOW, 20),
    renewalCycle: 'monthly',
    ...overrides,
  };
}

function slice(overrides: Partial<DashboardSlice> = {}): DashboardSlice {
  return {
    now: NOW,
    members: [],
    enrollments: [],
    attempts: [],
    certificates: [],
    publishedCourseIds: new Set(['c-1', 'c-2']),
    quizPassingScores: new Map([
      ['q-1', 70],
      ['q-2', 90],
    ]),
    coursePassingScores: new Map([['c-1', 70]]),
    ...overrides,
  };
}

describe('enrolment phases', () => {
  const table: [EnrollmentStatus, 'not_started' | 'in_progress' | 'finished'][] = [
    ['enrolled', 'not_started'],
    ['assigned', 'not_started'],
    ['in_progress', 'in_progress'],
    ['lessons_complete', 'in_progress'],
    ['locked', 'in_progress'],
    ['failed', 'in_progress'],
    ['retry_requested', 'in_progress'],
    ['completed', 'finished'],
    ['attested', 'finished'],
  ];

  it.each(table)('%s is %s', (status, phase) => {
    expect(ENROLLMENT_PHASE[status]).toBe(phase);
    expect(isUnfinishedStatus(status)).toBe(phase !== 'finished');
  });

  it('derives the finished and not-started sets from the phase map', () => {
    expect([...FINISHED_ENROLLMENT_STATUSES].sort()).toEqual(['attested', 'completed']);
    expect([...NOT_STARTED_ENROLLMENT_STATUSES].sort()).toEqual(['assigned', 'enrolled']);
  });
});

describe('overdue and due-soon', () => {
  it.each([
    ['one ms past due, unfinished', { dueAt: new Date(NOW.getTime() - 1) }, true],
    ['due exactly now', { dueAt: NOW }, false],
    ['no deadline', { dueAt: null }, false],
    ['past due but completed', { dueAt: daysBefore(NOW, 3), status: 'completed' as const }, false],
    ['past due and locked', { dueAt: daysBefore(NOW, 3), status: 'locked' as const }, true],
  ])('isOverdue: %s', (_label, overrides, expected) => {
    expect(isOverdue(enrollment(overrides), NOW)).toBe(expected);
  });

  it.each([
    ['due now', { dueAt: NOW }, true],
    ['due at the 14-day edge', { dueAt: daysAfter(NOW, 14) }, true],
    ['due one ms past the edge', { dueAt: new Date(daysAfter(NOW, 14).getTime() + 1) }, false],
    ['already overdue', { dueAt: daysBefore(NOW, 1) }, false],
    ['finished', { dueAt: daysAfter(NOW, 2), status: 'attested' as const }, false],
  ])('isDueSoon: %s', (_label, overrides, expected) => {
    expect(isDueSoon(enrollment(overrides), NOW)).toBe(expected);
  });

  it('keeps the Prisma twins on the same bounds as the predicates', () => {
    expect(overdueEnrollmentWhere(NOW)).toEqual({
      status: { notIn: ['completed', 'attested'] },
      dueAt: { not: null, lt: NOW },
    });
    expect(dueSoonEnrollmentWhere(NOW)).toEqual({
      status: { notIn: ['completed', 'attested'] },
      dueAt: { gte: NOW, lte: daysAfter(NOW, 14) },
    });
  });
});

describe('dormancy', () => {
  it.each([
    [
      'R1 — joined long ago, never logged in',
      member({ lastLoginAt: null }),
      [] as DashboardEnrollment[],
      true,
    ],
    [
      'R1 — last login 15 days ago',
      member({ lastLoginAt: daysBefore(NOW, 15) }),
      [] as DashboardEnrollment[],
      true,
    ],
    [
      'R1 grace — joined 10 days ago, never logged in',
      member({ joinedAt: daysBefore(NOW, 10), lastLoginAt: null }),
      [] as DashboardEnrollment[],
      false,
    ],
    ['zero assignments alone is not dormant', member(), [] as DashboardEnrollment[], false],
    [
      'R2 — assigned 8 days ago, never started',
      member(),
      [
        enrollment({
          status: 'assigned',
          startedAt: daysBefore(NOW, 8),
          lastActivityAt: daysBefore(NOW, 8),
        }),
      ],
      true,
    ],
    [
      'R2 — assigned 5 days ago',
      member(),
      [enrollment({ status: 'enrolled', startedAt: daysBefore(NOW, 5), lastActivityAt: null })],
      false,
    ],
    [
      'R2 — assigned 20 days ago but access only opened 3 days ago',
      member(),
      [
        enrollment({
          status: 'assigned',
          startedAt: daysBefore(NOW, 20),
          accessAt: daysBefore(NOW, 3),
          lastActivityAt: null,
        }),
      ],
      false,
    ],
    [
      'R3 — in progress, last activity 15 days ago',
      member(),
      [enrollment({ status: 'in_progress', lastActivityAt: daysBefore(NOW, 15) })],
      true,
    ],
    [
      'R3 — started 20 days ago with no activity recorded falls back to startedAt',
      member(),
      [enrollment({ status: 'failed', startedAt: daysBefore(NOW, 20), lastActivityAt: null })],
      true,
    ],
    [
      'R3 — in progress, active yesterday',
      member(),
      [enrollment({ status: 'in_progress', lastActivityAt: daysBefore(NOW, 1) })],
      false,
    ],
    [
      'a finished enrolment never trips R2/R3',
      member(),
      [enrollment({ status: 'completed', lastActivityAt: daysBefore(NOW, 90) })],
      false,
    ],
  ])('%s', (_label, m, enrollments, expected) => {
    expect(isDormantMember(m, enrollments, NOW)).toBe(expected);
  });
});

describe('first-time pass', () => {
  it('counts the EARLIEST submitted attempt per (enrolment, quiz), not the latest', () => {
    const outcomes = firstAttemptOutcomes(
      slice({
        enrollments: [enrollment()],
        attempts: [
          attempt({ score: 88, completedAt: daysBefore(NOW, 1) }),
          attempt({ score: 60, completedAt: daysBefore(NOW, 2) }),
        ],
      }),
    );

    expect(outcomes).toEqual({ total: 1, passed: 0 });
  });

  it('ignores retakes but counts renewals as first attempts', () => {
    const outcomes = firstAttemptOutcomes(
      slice({
        enrollments: [
          enrollment({ id: 'e-retake', retakeOf: 'e-0' }),
          enrollment({ id: 'e-renewal' }),
        ],
        attempts: [
          attempt({ enrollmentId: 'e-retake', score: 95 }),
          attempt({ enrollmentId: 'e-renewal', score: 75 }),
        ],
      }),
    );

    expect(outcomes).toEqual({ total: 1, passed: 1 });
  });

  it('judges each quiz against its own passing score across a multi-quiz course', () => {
    const outcomes = firstAttemptOutcomes(
      slice({
        enrollments: [enrollment()],
        attempts: [attempt({ quizId: 'q-1', score: 75 }), attempt({ quizId: 'q-2', score: 75 })],
      }),
    );

    expect(outcomes).toEqual({ total: 2, passed: 1 });
  });
});

describe('grades', () => {
  it('takes the mean of per-quiz BEST scores per enrolment', () => {
    const grades = enrollmentGrades([
      attempt({ quizId: 'q-1', score: 60 }),
      attempt({ quizId: 'q-1', score: 88 }),
      attempt({ quizId: 'q-2', score: 70 }),
    ]);

    expect(grades.get('e-1')).toBe(79);
  });

  it('averages across enrolments and is 0 with nothing graded', () => {
    const grades = enrollmentGrades([
      attempt({ enrollmentId: 'e-1', score: 90 }),
      attempt({ enrollmentId: 'e-2', score: 71 }),
    ]);

    expect(averageGrade(grades)).toBe(81);
    expect(averageGrade(new Map())).toBe(0);
  });
});

describe('credentials', () => {
  // monthly = 30 days
  it.each([
    ['expiring — issued 20 days ago, expires in 10', certificate(), [], 'expiring'],
    ['window edge — expires exactly 30 days out', certificate({ issuedAt: NOW }), [], 'expiring'],
    ['valid — expires 31 days out', certificate({ issuedAt: daysAfter(NOW, 1) }), [], 'valid'],
    ['expired — issued 40 days ago', certificate({ issuedAt: daysBefore(NOW, 40) }), [], 'expired'],
    [
      'superseded by a later completed renewal',
      certificate({ issuedAt: daysBefore(NOW, 40) }),
      [enrollment({ id: 'e-2', status: 'attested', completedAt: daysBefore(NOW, 5) })],
      'superseded',
    ],
    [
      'NOT superseded by an unfinished renewal',
      certificate({ issuedAt: daysBefore(NOW, 40) }),
      [enrollment({ id: 'e-2', status: 'in_progress' })],
      'expired',
    ],
    [
      'NOT superseded by its own enrolment',
      certificate({ issuedAt: daysBefore(NOW, 40) }),
      [enrollment({ id: 'e-1', status: 'attested', completedAt: daysBefore(NOW, 39) })],
      'expired',
    ],
  ] as const)('%s', (_label, cert, memberEnrollments, expected) => {
    expect(classifyCredential(cert, memberEnrollments, NOW)).toBe(expected);
  });
});

describe('learners and courses', () => {
  it('counts distinct learners with an unfinished enrolment, and published courses only', () => {
    const enrollments = [
      enrollment({ id: 'a', organizationUserId: 'm-1', courseId: 'c-1', status: 'locked' }),
      enrollment({ id: 'b', organizationUserId: 'm-1', courseId: 'c-2', status: 'assigned' }),
      enrollment({ id: 'c', organizationUserId: 'm-2', courseId: 'c-draft', status: 'assigned' }),
      enrollment({ id: 'd', organizationUserId: 'm-3', courseId: 'c-1', status: 'attested' }),
    ];

    expect(countActiveLearners(enrollments)).toBe(2);
    expect(countActiveCourses(enrollments, new Set(['c-1', 'c-2']))).toBe(2);
  });
});

describe('population where-builders', () => {
  it('has no role outside the worker and admin tiers', () => {
    expect([...ALL_ROLES].sort()).toEqual([...ADMIN_ROLES, ...WORKER_ROLES].sort());
  });

  it('admits every active worker and only admins with a live-course enrolment', () => {
    const live = { organizationId: 'org-1', archivedAt: null };
    const where = staffPopulationWhere({
      organizationId: 'org-1',
      liveCourseWhere: live,
      rosterWhere: {},
    });

    expect(where).toEqual({
      organizationId: 'org-1',
      active: true,
      OR: [
        { role: { in: [...WORKER_ROLES] } },
        { role: { in: [...ADMIN_ROLES] }, enrollments: { some: { course: live } } },
      ],
    });
  });

  it('reconstructs the previous population from joinedAt / deactivatedAt', () => {
    const asOf = daysBefore(NOW, 30);
    const where = previousStaffPopulationWhere({
      organizationId: 'org-1',
      liveCourseWhere: {},
      rosterWhere: {},
      asOf,
    });

    expect(where.joinedAt).toEqual({ lt: asOf });
    expect(where.active).toBeUndefined();
    expect(where.AND).toContainEqual({ OR: [{ active: true }, { deactivatedAt: { gte: asOf } }] });
  });
});

describe('sliceSnapshot — current-roster attribution', () => {
  const twoFacility = member({ id: 'm-two', facilityIds: ['fac-a', 'fac-b'] });
  const noFacility = member({ id: 'm-none', facilityIds: [] });
  const onlyB = member({ id: 'm-b', facilityIds: ['fac-b'] });
  const snapshot = buildSnapshot(
    slice({
      members: [twoFacility, noFacility, onlyB],
      enrollments: [
        enrollment({ id: 'e-two', organizationUserId: 'm-two' }),
        enrollment({ id: 'e-none', organizationUserId: 'm-none' }),
        enrollment({ id: 'e-b', organizationUserId: 'm-b' }),
      ],
      attempts: [attempt({ enrollmentId: 'e-b' })],
    }),
  );

  it('puts a two-facility member in both facilities, once in their union', () => {
    expect(sliceSnapshot(snapshot, ['fac-a']).members.map((m) => m.id)).toEqual(['m-two']);
    expect(
      sliceSnapshot(snapshot, ['fac-b'])
        .members.map((m) => m.id)
        .sort(),
    ).toEqual(['m-b', 'm-two']);
    expect(sliceSnapshot(snapshot, ['fac-a', 'fac-b']).members).toHaveLength(2);
  });

  it('counts a no-facility member in the organisation total only', () => {
    expect(sliceSnapshot(snapshot, null).members).toHaveLength(3);
    expect(sliceSnapshot(snapshot, ['fac-a', 'fac-b']).enrollments.map((e) => e.id)).not.toContain(
      'e-none',
    );
  });

  it('carries each sliced member’s attempts with their enrolments', () => {
    expect(sliceSnapshot(snapshot, ['fac-a']).attempts).toHaveLength(0);
    expect(sliceSnapshot(snapshot, ['fac-b']).attempts).toHaveLength(1);
  });
});

describe('calculators', () => {
  const s = slice({
    members: [
      member({ id: 'm-1' }),
      member({ id: 'm-2', lastLoginAt: null }),
      member({ id: 'm-3' }),
    ],
    enrollments: [
      enrollment({
        id: 'e-1',
        organizationUserId: 'm-1',
        status: 'in_progress',
        dueAt: daysBefore(NOW, 20),
      }),
      enrollment({
        id: 'e-2',
        organizationUserId: 'm-2',
        status: 'assigned',
        dueAt: daysAfter(NOW, 3),
      }),
      enrollment({
        id: 'e-3',
        organizationUserId: 'm-3',
        status: 'attested',
        dueAt: daysBefore(NOW, 1),
        completedAt: daysBefore(NOW, 2),
      }),
    ],
    attempts: [
      attempt({ enrollmentId: 'e-1', score: 60, completedAt: daysBefore(NOW, 3) }),
      attempt({ enrollmentId: 'e-1', score: 88, completedAt: daysBefore(NOW, 2) }),
      attempt({ enrollmentId: 'e-3', score: 90 }),
    ],
    certificates: [certificate({ enrollmentId: 'e-3', organizationUserId: 'm-3' })],
  });

  it('computes the Global headline', () => {
    expect(computeHeadline(s)).toEqual({
      totalStaff: 3,
      activeLearners: 2,
      ongoingCourses: 1,
      firstTimePassRate: 50,
      overdueTrainings: 1,
      dormantStaff: 1,
      expiringCredentials: 1,
    });
  });

  it('computes the facility view per assignment', () => {
    const view = computeFacilityView(s);

    expect(view.totalActiveCourses).toBe(1);
    expect(view.totalAssignedLearners).toBe(2);
    expect(view.averageGrade).toBe(89);
    expect(view.coverage).toEqual({ completed: 1, inProgress: 1, notStarted: 1 });
    expect(view.totalAssignments).toBe(3);
    expect(view.byCourse.get('c-1')).toEqual({
      total: 3,
      finished: 1,
      passCount: 2,
      failCount: 0,
      meanGrade: 89,
    });
  });

  it('computes a facility row that agrees with the facility view', () => {
    const row = computeFacilityRow(s);
    const view = computeFacilityView(s);

    expect(row.activeLearners).toBe(view.totalAssignedLearners);
    expect(row.activeCourses).toBe(view.totalActiveCourses);
    expect(row.averageGrade).toBe(view.averageGrade);
    expect(row).toMatchObject({
      staffCount: 3,
      activeTrainings: 2,
      overdueTrainings: 1,
      approachingDeadlines: 1,
      completionPercent: 33,
      auditReadinessPercent: 33,
    });
    expect(row.signals).toEqual({
      overdueBeyondGrace: 1,
      overdueWithinGrace: 0,
      completionPercent: 33,
      expiredCredentials: 0,
      expiringCredentials: 1,
    });
  });
});
