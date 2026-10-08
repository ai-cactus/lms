---
name: invite-modal-bulk-roles-tests
description: InviteStaffModal bulk-role (Apply to all) unit/e2e test notes - jsdom CSV upload recipe and e2e selector contract
metadata:
  type: project
---

Unit: the CSV pre-fill path IS testable in jsdom with the real SheetJS parser. Two traps: the Dialog is portaled, so find the hidden file input with `document.querySelector`, not `container`; jsdom's File has no `arrayBuffer()` and `new Response(file)` stringifies it - override `file.arrayBuffer = async () => new TextEncoder().encode(text).buffer`.

e2e: step-1 button is `/^assign role$/i`, step-2 submit `/^invite \d+ staff$/i`, bulk select `{ name: 'Role to apply to everyone' }`, row select `{ name: 'Role for <email>' }`. `npm run e2e:local` tears the stack down with `down -v`, so every invocation starts on a fresh DB (no reseed pollution); use E2E_SKIP_BUILD=1 for runs 2..n of the same code.

Path rule round: worker/supervisor invites need a NAMED facility (`getByRole('option', { name: /^(?!global)/i }).first()`), org-wide roles need Global. Facility switch on step 1 reuses `combobox { name: 'Facility' }`. ChangeFacilityModal is a checkbox group ("Facilities"), "Review changes" -> "Update facilities". Prisma doubles ignore `where`, so facility-name leak tests assert the include/select args (user.ts) or the JS filter result (staff.ts).
