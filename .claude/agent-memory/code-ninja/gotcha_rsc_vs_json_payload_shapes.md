---
name: gotcha-rsc-vs-json-payload-shapes
description: When one builder feeds both an API route and an RSC prop, normalise Dates to ISO yourself — RSC preserves Date, JSON.stringify does not; plus the wall-clock hydration trap.
metadata:
  type: feedback
---

A payload shared by an API route and a server component reaches the client as **two
different shapes** unless you normalise it: `NextResponse.json` turns `Date` into an
ISO string, while the RSC boundary hands the client a real `Date`. Normalise every
timestamp to ISO **inside the shared builder** (`toIsoTimestamp`-style helper that
tolerates `Date | string | null`, because route tests mock strings).

**Why:** hit while SSR-ing `/learn/[id]` (PR 6 of the video-perf plan). The learn
client does `new Date(attempt.completedAt)` and `.find(a => a.timeTaken === null)`;
a silent `string` → `Date` swap is the kind of thing that only breaks in one branch.
Normalising in the builder keeps the route's JSON byte-identical AND makes the two
entry points seed identical types.

**How to apply:** any time you extract a route handler body into `src/lib/**` so a
server component can call it directly:
- Audit the payload for `Date`, `Decimal`, `BigInt`, class instances. **This repo's
  Prisma schema has zero `Decimal`/`BigInt` fields** (checked repo-wide), so `Date`
  and raw `Json` columns are the only real hazards.
- `undefined` values differ too (JSON drops the key, RSC keeps it as `undefined`) —
  harmless for optional reads, but don't assert on key presence across both paths.
- Guard the shape with a test: `expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)`.
- **Wall-clock derived state hydrates mismatched.** Anything computed from
  `Date.now()` in a `useState` initializer renders once on the server and again on
  hydration — put `suppressHydrationWarning` on the element that prints it (the
  quiz countdown span) rather than deferring the value into an effect, which
  reintroduces a flash.

Related: [[gotcha_revalidation_cache_is_identity_only]], [[auth_instance_vs_role]].

Server-page conventions for this kind of port: unauthenticated → `redirect('/login')`
(dominant; a couple of `/worker/**` pages use `/`), access denied or missing →
`notFound()` (see `dashboard/(main)/training/courses/[id]/page.tsx`), and a 500 from
the payload builder should fall through to rendering the client **without**
`initialData` so the existing fetch path still degrades the way it used to. There is
no `middleware.ts` in this repo despite CLAUDE.md's reference to one — every route
enforces its own access.
