/**
 * PERMANENT organization delete, for the /system console. The second step
 * after {@link softDeleteOrganization}: only an organization that is already
 * soft-deleted can be destroyed, and only while `SYSTEM_HARD_DELETE_ENABLED`
 * is on (staging only).
 *
 * In one transaction, under the organization row lock, it deletes everything
 * the organization owns, in an explicit order. A single `DELETE FROM
 * organizations` cannot do it: Postgres checks a Restrict edge the moment a
 * cascade reaches it, so `Course.creator` fires if memberships go before
 * courses, and `Enrollment.course` / `Certificate.course` / `QuizAttempt.quiz`
 * fire if courses go before enrolments. The order is {@link HARD_DELETE_ORDER}.
 *
 * What it keeps: every User row (multi-org people keep their other
 * memberships; the rest become memberless and can be invited again), audit-log
 * rows and PHI decisions (ids only, no FK), and the Stripe customer, which is
 * never touched. Invoice rows go with the organization; Stripe keeps the
 * originals.
 *
 * It REFUSES, rather than reaching into another tenant, whenever another
 * organization depends on this one's data: global courses, other
 * organizations' enrolments, offerings, assignments or certificates on its
 * courses, course versions built from its documents, content its members
 * authored elsewhere, or facility links. It also waits for running jobs and
 * video encodes.
 *
 * The Stripe subscription is cancelled first, only when the operator asked,
 * and only after every pre-check passed: a failed cancel then refuses with
 * nothing deleted, and a cancel followed by a refused or failed transaction
 * leaves a still-soft-deleted, retryable organization whose billing stopped.
 *
 * Stored files go after the commit, by exact recorded URI, minus any URI a
 * surviving row still references (course copies share objects). A storage
 * failure never undoes the delete; it is recorded for retry.
 *
 * Refusals are returned as values, never thrown: the Server Actions that call
 * this run in production, where thrown messages are redacted.
 */
import { rawPrisma } from '@/db/index';
import { Prisma } from '@/generated/prisma/client';
import { audit, auditCritical } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { lockOrganizations } from '@/lib/organization/owner-guard';
import { deleteStorageObjects } from '@/lib/storage/cleanup';
import { parseStorageUri } from '@/lib/storage/types';
import { SYSTEM_ORG_SLUG } from '@/lib/video/system-user';
import { cancelStripeSubscriptionNow } from '@/lib/system/cancel-subscription-now';
import { SYSTEM_ORGANIZATION_REFUSAL } from '@/lib/system/delete-organization';
import type { SoftDeleteActor } from '@/lib/system/delete-user';
import { HARD_DELETE_DISABLED_REFUSAL, isHardDeleteEnabled } from '@/lib/system/hard-delete-flag';
import { ORGANIZATION_DELETE_CONFIRM_WORD } from '@/lib/system/organization-delete-confirm';

export const NOT_SOFT_DELETED_ORGANIZATION_REFUSAL =
  'Delete this organization first. An organization must be deleted before it can be permanently deleted.';
export const NOT_ACKNOWLEDGED_ORGANIZATION_REFUSAL =
  'Confirm that you understand this permanently destroys the records above, including certificates.';
export const STRIPE_CANCEL_FAILED_REFUSAL =
  "Stripe could not cancel the subscription. Nothing was deleted. Try again, or clear 'Cancel the Stripe subscription now' to delete without cancelling.";
export const STILL_REFERENCED_REFUSAL =
  "Some records still reference this organization's data, so nothing was deleted.";
export const DELETE_FAILED_AFTER_CANCEL_REFUSAL =
  'The permanent delete failed and nothing was deleted. Try again.';

export function globalCoursesRefusal(count: number): string {
  return `This organization owns ${count} global course(s) shared with other organizations. It cannot be permanently deleted.`;
}

export function runningWorkRefusal(count: number): string {
  return `${count} background job(s) or video encode(s) are still running for this organization. Try again once they finish.`;
}

/** Other organizations' records that the delete would destroy or that would block it. */
export interface CrossOrganizationUsage {
  enrollments: number;
  offerings: number;
  certificates: number;
  quizAttempts: number;
  courseAssignments: number;
  inviteCourseAssignments: number;
  courseVersions: number;
  authoredCourses: number;
  uploadedDocuments: number;
  facilityLinks: number;
}

const CROSS_ORGANIZATION_LABELS: Record<keyof CrossOrganizationUsage, string> = {
  enrollments: 'enrollment(s)',
  offerings: 'offering(s)',
  certificates: 'certificate(s)',
  quizAttempts: 'quiz attempt(s)',
  courseAssignments: 'course assignment(s)',
  inviteCourseAssignments: 'invite course assignment(s)',
  courseVersions: 'course version(s) built from its documents',
  authoredCourses: 'course(s) authored by its members',
  uploadedDocuments: 'document(s) uploaded by its members',
  facilityLinks: 'facility link(s)',
};

export function crossOrganizationUsageRefusal(usage: CrossOrganizationUsage): string | null {
  const clauses = (Object.keys(CROSS_ORGANIZATION_LABELS) as (keyof CrossOrganizationUsage)[])
    .filter((key) => usage[key] > 0)
    .map((key) => `${usage[key]} ${CROSS_ORGANIZATION_LABELS[key]}`);
  if (clauses.length === 0) return null;
  return `Other organizations use this organization's courses or data (${clauses.join(', ')}). Permanently deleting would destroy their records, so it is refused.`;
}

export interface OrganizationHardDeleteCounts {
  memberships: number;
  facilities: number;
  courses: number;
  lessons: number;
  documents: number;
  documentVersions: number;
  enrollments: number;
  quizAttempts: number;
  certificates: number;
  notifications: number;
  courseAssignments: number;
  offerings: number;
  invites: number;
  invoices: number;
  categories: number;
  emailMessages: number;
  notificationEvents: number;
  cycleSummaryRuns: number;
  jobs: number;
}

export interface OrganizationHardDeletePreview {
  enabled: boolean;
  organization: { id: string; name: string; slug: string; deletedAt: Date | null };
  /** Why the delete would be refused; null when it may proceed. */
  refusal: string | null;
  destroyed: OrganizationHardDeleteCounts;
  /** Stored files recorded on the destroyed rows. Any a surviving copy still uses is kept. */
  storageObjects: number;
  kept: {
    users: number;
    usersAlsoInOtherOrgs: number;
    usersLeftWithoutOrganization: number;
    auditLogs: number;
    phiDecisions: number;
    stripeCustomer: boolean;
  };
  subscription: { plan: string; status: string; cancelAtPeriodEnd: boolean } | null;
  /** A subscription exists that Stripe may still be billing. */
  canCancelSubscription: boolean;
}

export type SubscriptionOutcome = 'cancelled' | 'already_cancelled' | 'not_requested' | 'none';

export type HardDeleteOrganizationResult =
  | {
      status: 'deleted';
      counts: OrganizationHardDeleteCounts;
      storage: { attempted: number; failed: number };
      subscription: SubscriptionOutcome;
    }
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'not_soft_deleted' }
  | { status: 'confirmation_mismatch' }
  | { status: 'not_acknowledged' }
  | { status: 'refused'; message: string; subscriptionCancelled: boolean };

export interface HardDeleteOrganizationConfirmation {
  confirmName: string;
  confirmWord: string;
  acknowledged: boolean;
  cancelSubscription: boolean;
}

/** The unfiltered client or its transaction: archived courses and documents must count. */
type RawClient = Omit<Prisma.TransactionClient, symbol>;

const RAW_TRANSACTION_TIMEOUT_MS = 120_000;
const REFERENCE_CHECK_CHUNK = 500;

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  deletedAt: true,
  stripeCustomerId: true,
  subscription: {
    select: {
      plan: true,
      status: true,
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: true,
    },
  },
} as const;

type OrganizationRecord = Prisma.OrganizationGetPayload<{ select: typeof ORGANIZATION_SELECT }>;

/**
 * Tables keyed by an organization id with no foreign key, so no cascade
 * reaches them. These rows are the organization's; delete them by id.
 * `AuditLog` and `PhiDecision` are the same shape but are deliberately kept.
 */
export const DELETE_BY_ORGANIZATION_ID_MODELS = [
  'NotificationEvent',
  'EmailMessage',
  'CycleSummaryRun',
] as const;
export const KEPT_ORGANIZATION_ID_MODELS = ['AuditLog', 'PhiDecision'] as const;

interface DeleteStep {
  model: string;
  run: (tx: RawClient, organizationId: string) => Promise<unknown>;
}

/**
 * The delete order. Each later step relies on an earlier one having removed
 * the rows that would trip a Restrict edge; the schema manifest test pins the
 * Restrict edges to these steps.
 */
const DELETE_STEPS: readonly DeleteStep[] = [
  {
    model: 'NotificationEvent',
    run: (tx, organizationId) => tx.notificationEvent.deleteMany({ where: { organizationId } }),
  },
  {
    model: 'EmailMessage',
    run: (tx, organizationId) => tx.emailMessage.deleteMany({ where: { organizationId } }),
  },
  {
    model: 'CycleSummaryRun',
    run: (tx, organizationId) => tx.cycleSummaryRun.deleteMany({ where: { organizationId } }),
  },
  {
    // Course-generation jobs (SEC-14) and auditor exports (RISK-19) stamp the
    // organization they run for; their result holds the generated course or the
    // org's audit report. Jobs without the stamp — including exports created
    // before it existed — stay with their user, who is kept.
    model: 'Job',
    run: (tx, organizationId) =>
      tx.job.deleteMany({
        where: { payload: { path: ['organizationId'], equals: organizationId } },
      }),
  },
  {
    // Cascades quiz attempts, certificates and reminder rows. Before courses:
    // Enrollment.course and Certificate.course are Restrict.
    model: 'Enrollment',
    run: (tx, organizationId) =>
      tx.enrollment.deleteMany({ where: { organizationUser: { organizationId } } }),
  },
  {
    // Cascades modules, lessons, quizzes, artifacts, versions, assignments,
    // offerings and invite course assignments. Before memberships:
    // Course.creator is Restrict. Before documents: CourseVersion.documentVersion
    // is Restrict.
    model: 'Course',
    run: (tx, organizationId) => tx.course.deleteMany({ where: { organizationId } }),
  },
  {
    model: 'Document',
    run: (tx, organizationId) => tx.document.deleteMany({ where: { organizationId } }),
  },
  {
    // Cascades facility rows, notifications and notification preferences.
    // The User rows stay.
    model: 'OrganizationUser',
    run: (tx, organizationId) => tx.organizationUser.deleteMany({ where: { organizationId } }),
  },
  {
    model: 'Invite',
    run: (tx, organizationId) => tx.invite.deleteMany({ where: { organizationId } }),
  },
  {
    model: 'Facility',
    run: (tx, organizationId) => tx.facility.deleteMany({ where: { organizationId } }),
  },
  {
    // Cascades subscription, invoices, categories, offerings, assignments and
    // notification category preferences.
    model: 'Organization',
    run: (tx, organizationId) => tx.organization.delete({ where: { id: organizationId } }),
  },
];

export const HARD_DELETE_ORDER: readonly string[] = DELETE_STEPS.map((step) => step.model);

type StorageRow = Record<string, string | null>;

interface StorageSource {
  columns: readonly string[];
  /** The rows of this model the delete destroys. */
  where: (organizationId: string) => object;
  /** Extra columns {@link owns} reads. */
  extraSelect?: readonly string[];
  /**
   * For columns a client request can set to any string: only an object under
   * this organization's (or its uploader's) own prefix is deleted.
   */
  owns?: (key: string, row: StorageRow, organizationId: string) => boolean;
}

const ORGANIZATION_STORAGE_SOURCES: Record<string, StorageSource> = {
  Lesson: {
    columns: ['videoStorageUri', 'videoPosterStorageUri'],
    where: (organizationId) => ({ course: { organizationId } }),
  },
  Course: {
    columns: ['previewVideoStorageUri', 'previewPosterStorageUri', 'thumbnailStorageUri'],
    where: (organizationId) => ({ organizationId }),
  },
  CourseArtifact: {
    columns: ['storageUri'],
    where: (organizationId) => ({ course: { organizationId } }),
  },
  DocumentVersion: {
    columns: ['storagePath'],
    where: (organizationId) => ({ document: { organizationId } }),
  },
  Certificate: {
    columns: ['pdfStoragePath'],
    where: (organizationId) => ({ organizationUser: { organizationId } }),
  },
  Facility: {
    columns: ['complianceDocumentUrl'],
    where: (organizationId) => ({ organizationId }),
    owns: (key, _row, organizationId) => key.startsWith(`organizations/${organizationId}/`),
  },
  FacilityDocument: {
    columns: ['url'],
    where: (organizationId) => ({ facility: { organizationId } }),
    extraSelect: ['uploadedById'],
    owns: (key, row) =>
      Boolean(row.uploadedById) && key.startsWith(`onboarding/${row.uploadedById}/`),
  },
};

/** Columns holding a storage URI that the delete collects, as `Model.field`. */
export const STORAGE_URI_COLUMNS: readonly string[] = Object.entries(
  ORGANIZATION_STORAGE_SOURCES,
).flatMap(([model, source]) => source.columns.map((column) => `${model}.${column}`));

/**
 * Storage columns on rows the delete never touches. Never collected, but a URI
 * one of them still names is never deleted either.
 */
export const REFERENCE_ONLY_STORAGE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  User: ['avatarUrl'],
  StandardManual: ['storagePath'],
};

interface FindManyDelegate {
  findMany(args: { where: object; select: Record<string, true> }): Promise<StorageRow[]>;
}

/** Prisma's delegate for a model name, for the column-driven storage queries. */
function delegateFor(client: RawClient, model: string): FindManyDelegate {
  const name = `${model[0].toLowerCase()}${model.slice(1)}`;
  return (client as unknown as Record<string, FindManyDelegate>)[name];
}

function selectOf(columns: readonly string[]): Record<string, true> {
  return Object.fromEntries(columns.map((column) => [column, true as const]));
}

function storageKeyOf(uri: string): string | null {
  try {
    const { key } = parseStorageUri(uri);
    return key.split('/').includes('..') ? null : key;
  } catch {
    return null;
  }
}

async function collectStorageUris(
  client: RawClient,
  organizationId: string,
): Promise<{ uris: string[]; skippedForeign: number }> {
  const uris = new Set<string>();
  let skippedForeign = 0;

  for (const [model, source] of Object.entries(ORGANIZATION_STORAGE_SOURCES)) {
    const rows = await delegateFor(client, model).findMany({
      where: source.where(organizationId),
      select: selectOf([...source.columns, ...(source.extraSelect ?? [])]),
    });
    for (const row of rows) {
      for (const column of source.columns) {
        const uri = row[column];
        if (!uri) continue;
        const key = storageKeyOf(uri);
        if (key === null || (source.owns && !source.owns(key, row, organizationId))) {
          skippedForeign += 1;
          continue;
        }
        uris.add(uri);
      }
    }
  }

  return { uris: [...uris], skippedForeign };
}

/**
 * The candidate URIs some surviving row still names. Run after the deletes,
 * inside the transaction, so every row left is outside this organization: a
 * duplicated or seeded course elsewhere can share the exact same object.
 */
async function findStillReferenced(client: RawClient, uris: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  const sources: [string, readonly string[]][] = [
    ...Object.entries(ORGANIZATION_STORAGE_SOURCES).map(
      ([model, source]): [string, readonly string[]] => [model, source.columns],
    ),
    ...Object.entries(REFERENCE_ONLY_STORAGE_COLUMNS),
  ];

  for (let start = 0; start < uris.length; start += REFERENCE_CHECK_CHUNK) {
    const chunk = uris.slice(start, start + REFERENCE_CHECK_CHUNK);
    const candidates = new Set(chunk);
    for (const [model, columns] of sources) {
      const rows = await delegateFor(client, model).findMany({
        where: { OR: columns.map((column) => ({ [column]: { in: chunk } })) },
        select: selectOf(columns),
      });
      for (const row of rows) {
        for (const column of columns) {
          const uri = row[column];
          if (uri && candidates.has(uri)) referenced.add(uri);
        }
      }
    }
  }

  return referenced;
}

async function countCrossOrganizationUsage(
  client: RawClient,
  organizationId: string,
): Promise<CrossOrganizationUsage> {
  const elsewhere = { not: organizationId };
  const thisOrgsCourse = { course: { organizationId } };
  const otherOrgsMember = { organizationUser: { organizationId: elsewhere } };

  const [
    enrollments,
    offerings,
    certificates,
    quizAttempts,
    courseAssignments,
    inviteCourseAssignments,
    courseVersions,
    authoredCourses,
    uploadedDocuments,
    facilityMemberships,
    facilityInvites,
  ] = await Promise.all([
    client.enrollment.count({ where: { ...thisOrgsCourse, ...otherOrgsMember } }),
    client.orgCourseOffering.count({ where: { ...thisOrgsCourse, organizationId: elsewhere } }),
    client.certificate.count({ where: { ...thisOrgsCourse, ...otherOrgsMember } }),
    client.quizAttempt.count({
      where: {
        enrollment: otherOrgsMember,
        quiz: {
          OR: [{ course: { organizationId } }, { lesson: { course: { organizationId } } }],
        },
      },
    }),
    client.courseAssignment.count({ where: { ...thisOrgsCourse, organizationId: elsewhere } }),
    client.inviteCourseAssignment.count({
      where: { ...thisOrgsCourse, invite: { organizationId: elsewhere } },
    }),
    client.courseVersion.count({
      where: {
        documentVersion: { document: { organizationId } },
        course: { organizationId: elsewhere },
      },
    }),
    client.course.count({ where: { creator: { organizationId }, organizationId: elsewhere } }),
    client.document.count({
      where: { organizationUser: { organizationId }, organizationId: elsewhere },
    }),
    client.organizationUserFacility.count({
      where: { facility: { organizationId }, ...otherOrgsMember },
    }),
    client.invite.count({ where: { facility: { organizationId }, organizationId: elsewhere } }),
  ]);

  return {
    enrollments,
    offerings,
    certificates,
    quizAttempts,
    courseAssignments,
    inviteCourseAssignments,
    courseVersions,
    authoredCourses,
    uploadedDocuments,
    facilityLinks: facilityMemberships + facilityInvites,
  };
}

/**
 * Running work that would fail, or orphan its output, once its rows are gone.
 * `Job` carries only a user id (plus the organization stamp on course
 * generation, SEC-14, and auditor exports, RISK-19), so a member's running job
 * for another organization also waits here: a transient over-refusal, accepted.
 */
async function countRunningWork(client: RawClient, organizationId: string): Promise<number> {
  const members = await client.organizationUser.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  const [jobs, lessonEncodes, previewEncodes] = await Promise.all([
    client.job.count({
      where: {
        status: { in: ['queued', 'processing'] },
        OR: [
          { userId: { in: members.map((member) => member.userId) } },
          { payload: { path: ['organizationId'], equals: organizationId } },
        ],
      },
    }),
    client.lesson.count({ where: { course: { organizationId }, mediaStatus: 'processing' } }),
    client.course.count({ where: { organizationId, previewMediaStatus: 'processing' } }),
  ]);
  return jobs + lessonEncodes + previewEncodes;
}

/**
 * The refusals that depend on the data rather than the request. Null when the
 * delete may proceed.
 */
async function findDataRefusal(
  client: RawClient,
  organization: Pick<OrganizationRecord, 'id' | 'slug'>,
): Promise<string | null> {
  if (organization.slug === SYSTEM_ORG_SLUG) return SYSTEM_ORGANIZATION_REFUSAL;

  const globalCourses = await client.course.count({
    where: { organizationId: organization.id, isGlobal: true },
  });
  if (globalCourses > 0) return globalCoursesRefusal(globalCourses);

  const crossOrganization = crossOrganizationUsageRefusal(
    await countCrossOrganizationUsage(client, organization.id),
  );
  if (crossOrganization) return crossOrganization;

  const running = await countRunningWork(client, organization.id);
  return running > 0 ? runningWorkRefusal(running) : null;
}

async function countDestroyed(
  client: RawClient,
  organizationId: string,
): Promise<OrganizationHardDeleteCounts> {
  const ofThisOrg = { organizationId };
  const memberOfThisOrg = { organizationUser: { organizationId } };
  const [
    memberships,
    facilities,
    courses,
    lessons,
    documents,
    documentVersions,
    enrollments,
    quizAttempts,
    certificates,
    notifications,
    courseAssignments,
    offerings,
    invites,
    invoices,
    courseCategories,
    documentCategories,
    emailMessages,
    notificationEvents,
    cycleSummaryRuns,
    jobs,
  ] = await Promise.all([
    client.organizationUser.count({ where: ofThisOrg }),
    client.facility.count({ where: ofThisOrg }),
    client.course.count({ where: ofThisOrg }),
    client.lesson.count({ where: { course: ofThisOrg } }),
    client.document.count({ where: ofThisOrg }),
    client.documentVersion.count({ where: { document: ofThisOrg } }),
    client.enrollment.count({ where: memberOfThisOrg }),
    client.quizAttempt.count({ where: { enrollment: memberOfThisOrg } }),
    client.certificate.count({ where: memberOfThisOrg }),
    client.notification.count({ where: memberOfThisOrg }),
    client.courseAssignment.count({ where: ofThisOrg }),
    client.orgCourseOffering.count({ where: ofThisOrg }),
    client.invite.count({ where: ofThisOrg }),
    client.invoice.count({ where: ofThisOrg }),
    client.courseCategory.count({ where: ofThisOrg }),
    client.documentCategory.count({ where: ofThisOrg }),
    client.emailMessage.count({ where: ofThisOrg }),
    client.notificationEvent.count({ where: ofThisOrg }),
    client.cycleSummaryRun.count({ where: ofThisOrg }),
    client.job.count({ where: { payload: { path: ['organizationId'], equals: organizationId } } }),
  ]);

  return {
    memberships,
    facilities,
    courses,
    lessons,
    documents,
    documentVersions,
    enrollments,
    quizAttempts,
    certificates,
    notifications,
    courseAssignments,
    offerings,
    invites,
    invoices,
    categories: courseCategories + documentCategories,
    emailMessages,
    notificationEvents,
    cycleSummaryRuns,
    jobs,
  };
}

function hasLiveSubscription(organization: OrganizationRecord): boolean {
  return organization.subscription !== null && organization.subscription.status !== 'canceled';
}

export async function previewOrganizationHardDelete(
  organizationId: string,
): Promise<OrganizationHardDeletePreview | null> {
  const organization = await rawPrisma.organization.findUnique({
    where: { id: organizationId },
    select: ORGANIZATION_SELECT,
  });
  if (!organization) return null;

  const [destroyed, storage, usersAlsoInOtherOrgs, auditLogs, phiDecisions, dataRefusal] =
    await Promise.all([
      countDestroyed(rawPrisma, organizationId),
      collectStorageUris(rawPrisma, organizationId),
      rawPrisma.organizationUser.count({
        where: {
          organizationId,
          user: { organizationMemberships: { some: { organizationId: { not: organizationId } } } },
        },
      }),
      rawPrisma.auditLog.count({ where: { organizationId } }),
      rawPrisma.phiDecision.count({ where: { organizationId } }),
      findDataRefusal(rawPrisma, organization),
    ]);

  const enabled = isHardDeleteEnabled();
  const refusal = !enabled
    ? HARD_DELETE_DISABLED_REFUSAL
    : !organization.deletedAt
      ? NOT_SOFT_DELETED_ORGANIZATION_REFUSAL
      : dataRefusal;

  const { subscription } = organization;
  return {
    enabled,
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      deletedAt: organization.deletedAt,
    },
    refusal,
    destroyed,
    storageObjects: storage.uris.length,
    kept: {
      // One membership per person per organization, so members are people.
      users: destroyed.memberships,
      usersAlsoInOtherOrgs,
      usersLeftWithoutOrganization: destroyed.memberships - usersAlsoInOtherOrgs,
      auditLogs,
      phiDecisions,
      stripeCustomer: organization.stripeCustomerId !== null,
    },
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    canCancelSubscription: hasLiveSubscription(organization),
  };
}

function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

function confirmationMatches(
  name: string,
  confirmation: Pick<HardDeleteOrganizationConfirmation, 'confirmName' | 'confirmWord'>,
): boolean {
  return (
    confirmation.confirmName === name &&
    confirmation.confirmWord === ORGANIZATION_DELETE_CONFIRM_WORD
  );
}

export async function hardDeleteOrganization(
  organizationId: string,
  confirmation: HardDeleteOrganizationConfirmation,
  actor: SoftDeleteActor,
): Promise<HardDeleteOrganizationResult> {
  if (!isHardDeleteEnabled()) return { status: 'disabled' };

  const organization = await rawPrisma.organization.findUnique({
    where: { id: organizationId },
    select: ORGANIZATION_SELECT,
  });
  if (!organization) return { status: 'not_found' };
  if (!organization.deletedAt) return { status: 'not_soft_deleted' };
  if (!confirmationMatches(organization.name, confirmation)) {
    return { status: 'confirmation_mismatch' };
  }
  if (confirmation.acknowledged !== true) return { status: 'not_acknowledged' };

  const preCheckRefusal = await findDataRefusal(rawPrisma, organization);
  if (preCheckRefusal) {
    logger.warn({ msg: '[system] Organization hard delete refused', orgId: organizationId });
    return { status: 'refused', message: preCheckRefusal, subscriptionCancelled: false };
  }

  const { subscription } = organization;
  let subscriptionOutcome: SubscriptionOutcome = subscription
    ? confirmation.cancelSubscription
      ? 'cancelled'
      : 'not_requested'
    : 'none';

  // Before the transaction, never after: once the rows are gone a failed
  // cancel would leave the customer billed with no pointer left in the app.
  if (subscription && confirmation.cancelSubscription) {
    try {
      subscriptionOutcome = await cancelStripeSubscriptionNow(
        organizationId,
        subscription.stripeSubscriptionId,
      );
    } catch (err) {
      logger.error({
        msg: '[system] Organization hard delete refused: Stripe cancel failed',
        orgId: organizationId,
        err,
      });
      return {
        status: 'refused',
        message: STRIPE_CANCEL_FAILED_REFUSAL,
        subscriptionCancelled: false,
      };
    }
  }
  const subscriptionCancelled = subscriptionOutcome === 'cancelled';

  let outcome;
  try {
    outcome = await rawPrisma.$transaction(
      async (tx) => {
        await lockOrganizations(tx, [organizationId]);

        const current = await tx.organization.findUnique({
          where: { id: organizationId },
          select: ORGANIZATION_SELECT,
        });
        if (!current) return { kind: 'not_found' as const };
        if (!current.deletedAt) return { kind: 'not_soft_deleted' as const };
        if (!confirmationMatches(current.name, confirmation)) {
          return { kind: 'confirmation_mismatch' as const };
        }

        const refusal = await findDataRefusal(tx, current);
        if (refusal) return { kind: 'refused' as const, message: refusal };

        const storage = await collectStorageUris(tx, organizationId);
        const counts = await countDestroyed(tx, organizationId);

        // The org picker's hint: falls back on its own when stale, but there is
        // no reason to leave it pointing at a row that no longer exists.
        await tx.user.updateMany({
          where: { lastActiveOrganizationId: organizationId },
          data: { lastActiveOrganizationId: null },
        });
        for (const step of DELETE_STEPS) {
          await step.run(tx, organizationId);
        }

        const stillReferenced = await findStillReferenced(tx, storage.uris);
        const exactUris = storage.uris.filter((uri) => !stillReferenced.has(uri));

        // Inside the transaction so the delete and its record commit together.
        // Ids and counts only. The Stripe ids are opaque and recorded on
        // purpose: the customer is kept, and this is the only link left to it.
        await auditCritical(
          {
            action: 'system.org.hard_delete',
            targetType: 'organization',
            targetId: organizationId,
            organizationId,
            metadata: {
              mode: 'hard',
              ...counts,
              storageObjects: {
                count: exactUris.length,
                sharedSkipped: stillReferenced.size,
                foreignSkipped: storage.skippedForeign,
              },
              subscription: {
                cancelRequested: confirmation.cancelSubscription,
                outcome: subscriptionOutcome,
                stripeCustomerId: current.stripeCustomerId,
                stripeSubscriptionId: current.subscription?.stripeSubscriptionId ?? null,
              },
            },
            ...actor,
          },
          tx,
        );

        return {
          kind: 'deleted' as const,
          counts,
          exactUris,
          sharedSkipped: stillReferenced.size,
          foreignSkipped: storage.skippedForeign,
        };
      },
      { timeout: RAW_TRANSACTION_TIMEOUT_MS },
    );
  } catch (err) {
    // A reference created between the in-transaction check and the delete
    // trips a Restrict edge; the whole transaction rolled back.
    if (isForeignKeyViolation(err)) {
      logger.warn({
        msg: '[system] Organization hard delete refused by a foreign key',
        orgId: organizationId,
        subscriptionCancelled,
      });
      return { status: 'refused', message: STILL_REFERENCED_REFUSAL, subscriptionCancelled };
    }
    if (!subscriptionCancelled) throw err;
    logger.error({
      msg: '[system] Organization hard delete failed after its Stripe subscription was cancelled',
      orgId: organizationId,
      err,
    });
    return {
      status: 'refused',
      message: DELETE_FAILED_AFTER_CANCEL_REFUSAL,
      subscriptionCancelled,
    };
  }

  switch (outcome.kind) {
    case 'not_found':
      return { status: 'not_found' };
    case 'not_soft_deleted':
      return { status: 'not_soft_deleted' };
    case 'confirmation_mismatch':
      return { status: 'confirmation_mismatch' };
    case 'refused':
      logger.warn({
        msg: '[system] Organization hard delete refused',
        orgId: organizationId,
        subscriptionCancelled,
      });
      return { status: 'refused', message: outcome.message, subscriptionCancelled };
    case 'deleted':
      break;
  }

  const deletion = await deleteStorageObjects(outcome.exactUris, {
    module: '[system]',
    ids: { orgId: organizationId },
  });
  const storage = { attempted: deletion.attempted, failed: deletion.failed.length };

  if (deletion.failed.length > 0) {
    // The only retry record once the rows are gone.
    await audit({
      action: 'system.org.hard_delete.storage_incomplete',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      metadata: { failedUris: deletion.failed },
      ...actor,
    });
  }

  logger.info({
    msg: '[system] Organization hard-deleted',
    orgId: organizationId,
    ...outcome.counts,
    storageAttempted: storage.attempted,
    storageFailed: storage.failed,
    storageSharedSkipped: outcome.sharedSkipped,
    storageForeignSkipped: outcome.foreignSkipped,
    subscription: subscriptionOutcome,
  });

  return { status: 'deleted', counts: outcome.counts, storage, subscription: subscriptionOutcome };
}
