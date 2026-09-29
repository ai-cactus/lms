/**
 * BUG-11: whether a member of `callerOrganizationId` may change this course's
 * content or settings. The caller must ALSO hold `course.edit` — this is only
 * the ownership half of the decision.
 *
 * A course belongs to the ORGANISATION (Q25, `Course.organizationId`), not to
 * the member who wrote it, so a colleague holding the verb may edit a course
 * they did not author — exactly as they may already assign, withdraw and
 * archive it. Authorship (`createdByOrgUserId`) grants nothing here, and neither
 * does the author's CURRENT membership (`creator.organizationId`), which moves
 * with the person rather than the course.
 *
 * A global catalogue course is refused even when the ids match: it is shared
 * with every tenant, so an edit would rewrite it for all of them — Theraptly
 * edits those from `/system`. An adopted course (an `OrgCourseOffering` row)
 * fails the id match on its own, because the publishing organisation owns it.
 *
 * Pure, so the learn payload can mirror it to decide whether to OFFER an editor
 * — which is a UI affordance only. Every write path re-checks it server-side.
 */
export function isCourseEditableByOrganization(
  course: { organizationId: string; isGlobal: boolean },
  callerOrganizationId: string | null | undefined,
): boolean {
  return (
    Boolean(callerOrganizationId) &&
    course.organizationId === callerOrganizationId &&
    !course.isGlobal
  );
}
