---
name: client-import-of-prisma-bearing-lib
description: A `'use client'` file must not value-import a lib module that imports `@/lib/prisma` — split the pure half out and re-export, as facility/scope already does
metadata:
  type: feedback
---

When a client component needs a constant or pure helper that lives in a lib module which
also imports `@/lib/prisma` (e.g. `@/lib/enrollment/assignment`), do **not** import it
directly. Move the pure half into its own module and re-export it from the server module
for the existing import sites.

**Why:** nothing in the repo stops it — there is no `server-only` marker on `@/lib/prisma`
or `db/index.ts`, and `tsc` is happy — so the failure is a bundler/runtime one: the whole
module graph (Prisma client + `@prisma/adapter-pg` + node builtins) is pulled into the
client bundle. Every existing "client imports a prisma-bearing lib" case in the repo
(`LearnClient` → `learn/get-learn-payload`, the facility components → `facility/scope`) is
a **type-only** import, which erases. `@/lib/facility/org-wide-roles` ↔ `@/lib/facility/scope`
is the established shape of the split: pure module, re-exported from the server one.

**How to apply:** before adding an import to a `'use client'` file, check whether the target
module (transitively) imports `@/lib/prisma`. If it does and the import is a value, create
the pure sibling module. Done for the reminder ladder in Phase 5 of the assign consolidation:
`src/lib/enrollment/reminder-ladder.ts` holds `WIZARD_REMINDER_STAGES`,
`MAX_WIZARD_REMINDER_ROWS`, `DEFAULT_WIZARD_REMINDER_DAYS` and `stageRowsToReminderDays`;
`assignment.ts` imports and re-exports the two constants.
