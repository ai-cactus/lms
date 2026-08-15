---
name: gotcha-video-playback-cache-is-in-process
description: The video-proxy playback cache is in-process (one container per env, no Redis) — so it CANNOT be invalidated from scripts/transcode-worker.ts, which runs as a separate spawned process.
metadata:
  type: project
---

`src/lib/video/playback-cache.ts` is deliberately **in-process only** (plain
bounded `Map`s), not Redis-backed.

**Why:** there is exactly ONE app container per environment (Docker Compose, no
pm2 cluster, no replicas — see [[deploy_topology]]), so an in-process map is
~100% effective and Redis would only add a hop plus serialization. The original
plan called for L1+L2 on the premise of a 2-instance pm2 cluster; that premise
is obsolete.

**The trap this creates:** `scripts/transcode-worker.ts` is spawned as a CHILD
PROCESS by `src/lib/queue/video-transcode-worker.ts`, and it is the child that
writes the `videoStorageUri` / `previewVideoStorageUri` repoint. Calling an
invalidation helper inside the script would be a no-op — different process, its
own empty maps. The invalidation therefore lives in the BullMQ job handler in
`video-transcode-worker.ts`, which runs inside the web process that serves the
proxy. Same reasoning applies to any future in-process cache: only server
actions, route handlers, and BullMQ handlers can evict; anything under
`scripts/` cannot.

**How to apply:** if the app is ever scaled horizontally or a dedicated worker
service is split out of the web container, this whole module needs an L2 in
Redis — every instance would otherwise hold its own partial, independently
stale view, and cross-process eviction would stop working entirely.

Related: [[gotcha-bare-auth-drops-set-cookie]]
