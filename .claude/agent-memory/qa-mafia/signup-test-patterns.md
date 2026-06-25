---
name: signup-test-patterns
description: Critical test patterns for signup/auth E2E tests and known gotchas
metadata:
  type: feedback
---

## Checkbox interaction (Radix UI)

Use `page.getByRole('checkbox').first().click({ force: true })` for the Terms checkbox on `/signup`. The Radix Checkbox component renders with `role="checkbox"` and an overlay div intercepts pointer events from `[name="agreeTerms"]` input selector.

**Why:** The `Checkbox` component from shadcn/ui wraps a Radix primitive that renders a visually styled button, not a native input. The underlying hidden input is not directly clickable.

**How to apply:** On any form with a Radix checkbox, use `page.getByRole('checkbox')` not `page.locator('[name="agreeTerms"]')`.

## DB timestamp injection (pg client + WAT timezone)

The pg client sends `Date` objects using local timezone format (e.g. `2026-06-25T09:08:26+01:00` when in WAT). For `timestamp without time zone` columns, PostgreSQL strips the offset and stores the LOCAL time as-is (09:08). The Prisma app server (also in WAT) queries with `new Date()` which converts to UTC for comparison. Result: a "past" date inserted from pg client may appear as FUTURE in the DB.

**Fix:** Always pass timestamps as UTC ISO strings with `::timestamp` cast:
```ts
const utcStr = new Date(Date.now() + expiresMs).toISOString().replace('T', ' ').replace('Z', '');
await db.query('INSERT ... VALUES ($1::timestamp)', [utcStr]);
```

**Why:** The `verification_tokens.expires` column is `timestamp without time zone`. The DB is in UTC but the test runner system (WAT, UTC+1) causes pg to add +01:00 offset.

**How to apply:** Any time you insert timestamps into this DB from test code (not via Prisma), use the UTC string + `::timestamp` cast pattern.

## Submit button disabled state

The signup form's submit button is disabled by the React component when any required field is unfilled OR when terms are unchecked. The Radix checkbox force-click may not update React state. Safe approach: after force-clicking checkbox, check if button is still disabled; if so, use `page.evaluate` to force `btn.disabled = false` before testing validation messages.

## Next.js server action mocking

Mocking Next.js server action responses via `page.route()` with a custom RSC format body fails because the client's `normalizeFlightData` cannot parse arbitrary strings. The mock throws a `TypeError: Cannot read properties of undefined (reading 'map')` which surfaces as `An unexpected error occurred.` in the UI. Do NOT attempt to mock server action RSC responses.

**Alternative:** Test server actions indirectly — either navigate to the target page directly, or insert test data into the DB and drive the page that consumes it.

## Email sending bypass

The LMS uses SMTP (nodemailer/Zoho) for verification emails. SMTP creds are not configured in dev. `signupWithRole` will fail and clean up the token if email sending fails. Cannot test the full "signup → email sent → verify-email" flow without SMTP credentials.

**Workaround for token consumption tests:** Insert verification tokens directly into DB using the `pg` client and drive `/verify?token=<token>` to test the actual verification API without email.
