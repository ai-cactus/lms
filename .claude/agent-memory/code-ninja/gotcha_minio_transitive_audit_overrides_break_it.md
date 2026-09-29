---
name: gotcha-minio-transitive-audit-overrides-break-it
description: stream-json / decode-uri-component / query-string alerts under minio@8 cannot be cleared with npm overrides; every fixed version breaks `require('minio')` or its stringify calls
metadata:
  type: project
---

minio@8.0.7 (and minio-js master 8.0.8, checked 2026-09-28) pins `stream-json ^1.8.0`
and `query-string ^7.1.3` (-> `decode-uri-component ^0.2.2`). SEC-01's Dependabot alerts
sit on those, and every fixed version breaks minio. This was proven in a scratch install:

- `stream-json >=3.5.0` is ESM-only and renamed `jsonl/Parser.js` to `jsonl/parser.js`.
  minio's `notification.js` requires `stream-json/jsonl/Parser.js` at module load, so
  `require('minio')` / `import 'minio'` throws MODULE_NOT_FOUND. The whole storage fallback dies.
- `decode-uri-component 0.5.0` is ESM-only with only a default export, so under query-string 7
  `require()` returns a namespace and `decodeComponent is not a function`. That breaks `parse`.
- `query-string 9.5.1` exports only `default`, so minio's `qs.stringify` is undefined.

**Why it's tolerable:** minio uses only `jsonl/Parser` in `NotificationPoller`
(listenBucketNotification, which the app never calls) and only `query-string.stringify`
(no decode). So neither vulnerable path is reachable.

**How to apply:** don't retry overrides. The options are to dismiss the alerts as
"vulnerable code not used" (a user or orchestrator decision), wait for upstream, or replace
the minio client.
