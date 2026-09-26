---
name: gotcha-revalidatetag-max-does-not-expire
description: In Next 16, revalidateTag(tag,'max') only MARKS STALE — the next read still gets the old value; { expire: 0 } is the immediate form and updateTag throws in Route Handlers
metadata:
  type: project
---

`revalidateTag(tag, profile)` in Next 16 does **not** purge the entry. The
second argument is a `cacheLife` profile and only its `expire` is read: it sets
how long stale content may still be served while the revalidation runs in the
background. `'max'` means `expire: never`, so a request right after the write
can be served the **old** value indefinitely. That reads like a caching bug and
is easy to ship, because `'max'` is what the deprecation warning for the
single-argument form tells you to add.

The three forms, from `next@16.3.3` (`next/dist/server/web/spec-extension/
revalidate.d.ts` + `revalidation-utils.js`) and
`nextjs.org/docs/app/api-reference/functions/revalidateTag`:

| call | effect |
| --- | --- |
| `revalidateTag(tag, 'max')` | stale-while-revalidate, unbounded window |
| `revalidateTag(tag, { expire: 0 })` | immediate expiry; next read is a miss |
| `updateTag(tag)` | immediate expiry + read-your-own-writes on the client |
| `revalidateTag(tag)` | deprecated; behaves like `{ expire: 0 }` |

**`updateTag` throws E872 whenever `workStore.page.endsWith('/route')`** — i.e.
in every Route Handler. In this repo that rules it out for the video catalog:
`createVideoCourse` is imported by `src/app/api/system/video-courses/route.ts`,
and `refreshCourseThumbnailSurfaces` is shared with the thumbnail upload route.
So `expireVideoCatalog()` in `src/lib/video/catalog-cache.ts` uses
`{ expire: 0 }` and every call site goes through it.

**How to apply:** before writing any `revalidateTag`, decide whether the caller
needs the data *gone* or merely *refreshed soon*, and check whether the function
can be reached from a Route Handler. The profile argument is not a formality.
The unit tests assert the exact `(tag, profile)` pair — the runtime effect
(first read recomputes) is only observable against a real server.
