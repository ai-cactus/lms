# Code-Ninja Memory Index

- [Offline migrations](project_offline_migrations.md) — dev DB (localhost:5433) often unreachable; scaffold Prisma migrations offline via `migrate diff --from-schema/--to-schema`.
- [Vitest @/generated alias](project_vitest_generated_alias.md) — vitest.config.mts must alias @/generated & @/db (most-specific first) or value-imports of generated Prisma fail in tests.
- [Email delivery tracking](project_email_delivery_tracking.md) — EmailMessage has two disjoint recording paths (dispatch vs sendMailTracked); reminder senders bypass sendMailTracked to avoid double-record.
