# Code-Ninja Memory Index

- [Auth instance-selector vs DB role](auth_instance_vs_role.md) — the `'admin'|'worker'` cookie/routing selector is NOT the DB role; don't conflate them.
- [Build type-checks everything](build_typecheck_scope.md) — `next build` type-checks scripts/ and tests too; `npm run lint` only covers src/.
- [RBAC role model](rbac_role_model.md) — 13 category-aware DB roles (5 manager + 8 worker, uniform worker perms); DEFAULT_SELF_SERVE_WORKER_ROLE + snake↔camel conversion in role-utils.ts.
- [Org/Facility split](org_facility_split.md) — location/compliance fields moved to Facility; one facility per org; facility.* = owner+supervisor only.
- [Offline migrations](project_offline_migrations.md) — dev DB (localhost:5433) often unreachable; scaffold Prisma migrations offline via `migrate diff --from-schema/--to-schema`.
- [migrate dev destructive diff](project_migrate_dev_destructive_diff.md) — `prisma migrate dev` autogen drops the raw-SQL pgvector `embedding` col + facility defaults; hand-author migrations instead.
- [migrate dev HNSW drift](project_migrate_dev_hnsw_drift.md) — every new migration spuriously drops `manual_chunks_embedding_hnsw_idx` (raw-SQL pgvector index); strip the DROP INDEX line.
- [Vitest @/generated alias](project_vitest_generated_alias.md) — vitest.config.mts must alias @/generated & @/db (most-specific first) or value-imports of generated Prisma fail in tests.
- [Email delivery tracking](project_email_delivery_tracking.md) — EmailMessage has two disjoint recording paths (dispatch vs sendMailTracked); reminder senders bypass sendMailTracked to avoid double-record.
- [E2E seed infra](project_e2e_seed_infra.md) — prisma/seed.ts (tsx, self-contained client), E2E rate-limit bypass, role-based login landings, quiz shape; assignRetake locked-only bug.
- [Secure-cookie delete + prod e2e gotchas](gotcha_secure_cookie_delete_and_prod_e2e.md) — cookies().delete omits Secure so __Secure- deletions fail in prod (next dev masks it); onboarding-worker image deadlock; CI e2e = next start.
- [Repro v4.6 AI pipeline locally](repro_v46_ai_pipeline_locally.md) — ADC unavailable in sandbox; drive gemini-flash-lite-latest via AI-Studio Express key in .env; model/token facts.
- [Phase 2 batch-quiz truncation](phase2_batch_quiz_truncation.md) — Stage C 0-questions root cause = 16384 output cap truncation; hybrid single-call/chunk fix; keep meta.requestedQuestionCount = original.
