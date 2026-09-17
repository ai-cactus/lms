---
name: q26-deny-shape-traps
description: Converting a page to `onDeny:'notFound'` — the three traps (maskEmail crash on email-less mock sessions, vacuous "card absent" assertions, org-less branch collapsing into the RBAC branch)
metadata:
  type: feedback
---

When converting a page gate to `requirePermission(perm, { onDeny: 'notFound' })`
(founder Q26), three things bite that nothing in the type system or the suite
warns about.

**Why:** shipped in `fix/rbac-uniform-deny-behavior` (13 sites). Each of these
produced either a red suite with a misleading message, or a green suite that
proved nothing.

**How to apply:**

1. **Mock sessions need `email`.** `evaluatePermission` calls
   `maskEmail(session.user.email)` on the DENY path only. A page test that
   mocks `@/auth` with no `email` passes on every allow case and fails the
   first deny case with `Cannot read properties of undefined (reading
   'indexOf')` — which reads as a bug in the page, not the fixture.

2. **`expect(queryByText(/don't have access/)).not.toBeInTheDocument()` goes
   vacuous** the moment the card is deleted — it can never fail again. On the
   allow path replace it with `expect(mockNotFound).not.toHaveBeenCalled()`.
   Likewise in e2e: `expect(getByText(...)).not.toBeVisible()` on removed copy.

3. **The deny assertion must be a PAIR.** `expect(mockNotFound).toHaveBeenCalled()`
   alone still passes if someone drops the options object (the guard then
   redirects, and `notFound` is simply never reached — but so is the `rejects`
   throw, so the test fails for a *different* reason and the message misleads).
   Assert `mockNotFound` called AND `mockRedirect` NOT called.

4. **The org-less branch is not the RBAC branch.** Several pages folded
   `!organizationId || !can(...)` into one denial card. Splitting them is
   mandatory, not cosmetic: a role that HOLDS the verb but is mid-onboarding
   must not 404, and falling through queries `organizationId: null`, which
   Prisma reads as "every row that belongs to no organisation".

Unauthenticated deliberately stays `redirect('/login')` — see the doc comment
in `src/lib/rbac/require-permission.ts`. Billing-state redirects are NOT Q26;
see [[gotcha_billing_state_redirect_is_not_rbac]].
