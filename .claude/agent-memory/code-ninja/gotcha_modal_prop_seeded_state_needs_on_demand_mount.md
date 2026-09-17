---
name: gotcha-modal-prop-seeded-state-needs-on-demand-mount
description: React Compiler's lint bans the reopen-resync effect, and resetting in close() re-reads pre-refresh props — mount prop-seeded modals on demand instead
metadata:
  type: project
---

A modal whose fields seed from props (`useState(member.firstName)`) must be
**mounted on demand** — `{isOpen && <EditProfileModal … />}` — not kept alive
with an `isOpen` prop. Both alternatives are wrong here:

- **Re-sync in an effect** (`useEffect(() => { if (!isOpen) return; setX(prop) })`)
  fails `npm run lint` with `react-hooks/set-state-in-effect`: "Calling setState
  synchronously within an effect can trigger cascading renders." This is a
  blocking ERROR, not a warning. `tsc` and vitest both pass — only lint catches it.
- **Reset in `close()`**, which is what `ChangeFacilityModal` does, is safe only
  because its state is a *selection* (`targetId`), not a copy of a prop. For
  prop-seeded fields it reads the props as they are AT CLOSE — i.e. before the
  `router.refresh()` the save just triggered has landed — so the next open shows
  the pre-edit values. Save "Danielle", reopen, see "Dana".

`CertificateModal` in `StaffProfileClient.tsx` is the on-demand precedent. The
cost is the Radix exit animation; the gain is that a fresh mount IS the resync,
with no effect and no reset branch.

**How to apply:** when adding a modal, ask whether its state is a *selection*
(reset in `close()` is fine) or a *copy of server data* (mount on demand). Say
which in the component's doc comment — a later reader will otherwise "optimise"
it back to a persistent mount and silently reintroduce the stale-prefill bug.

Related: [[gotcha_rhf_watch_react_compiler]] (the other React Compiler lint trap).
