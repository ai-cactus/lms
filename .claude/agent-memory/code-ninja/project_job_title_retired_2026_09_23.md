---
name: project-job-title-retired-2026-09-23
description: Founder ruling Q3/Q17 retired job titles product-wide on 2026-09-23; the column survives and three surfaces deliberately still say "Job Title"
metadata:
  type: project
---

Founder ruling 2026-09-23 (Q3/Q17): **the system-assigned role IS the person's
title.** No product surface sets a job title any more, and every display shows
the RBAC role display name instead. Owner/Admin/HR keep role *assignment*.

**Why:** managers were setting their own free-text title, which drifted from the
authorization fact the role represents and showed up in audit exports as
"Compliance/ Nurse" — two different things joined by a slash.

**How to apply:**

- `OrganizationUser.jobTitle` **still exists** (annotated `/// RETIRED …` in
  `prisma/organization.prisma`). Nothing reads or writes it. Do not resurrect it;
  do not drop it without a ruling — the drop is a deliberate later PR.
- Three surfaces DELIBERATELY still collect "Job Title" and are **not** part of
  this ruling, because they describe a sales prospect at their own company, not a
  member of the tenant: the Enterprise-plan inquiry modal in
  `SubscriptionTab.tsx`, `/api/billing/contact-enterprise`, and the
  `sendEnterpriseInquiryEmail` template. Leave them unless the founder says
  otherwise.
- `scripts/seed-qa-orgs.ts` still seeds ~40 `jobTitle` values. Left on purpose:
  it is a staging fixture script, the user's notes say not to tidy those orgs,
  and the seeded values are what `staff-profile-edit.spec.ts` uses to prove the
  column is not blanked on save.
- The auditor table's column header still reads **"Department/Role"** — a design
  label from the audit-reports Figma, left alone since the ruling did not cover
  it. It now holds only the role.

Related: [[gotcha_rbac_actor_lists_vs_permissions]],
[[gotcha_server_action_args_are_unchecked]].
