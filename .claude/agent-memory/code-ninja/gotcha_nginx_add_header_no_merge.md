---
name: gotcha-nginx-add-header-no-merge
description: One add_header inside an nginx location silently drops ALL six server-level security headers in lms2_nginx.conf.
metadata:
  type: feedback
---

Never put an `add_header` directive inside a `location` block in `lms2_nginx.conf` without repeating the entire server-level header set alongside it.

**Why:** nginx's `add_header` does not merge across configuration levels — directives at a lower level *replace* every inherited one rather than adding to them. Both server blocks emit six security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, CSP) that must stay byte-identical to `next.config.ts`. A single `add_header` in a new location would silently strip all six from every response that location serves, with no error and no `nginx -t` warning.

**How to apply:** First ask whether the edit is warranted at all — **nginx is not in the live request path** (the Cloudflare tunnel bypasses it; see [[deploy-topology]]), so a new `location` block is usually dead config that merely misleads the next reader. If you do edit it, leave the location header-free with an explicit comment saying why, or copy all six `add_header … always;` lines in verbatim; verify with `curl -I` against a URL matching the new location, not just `/`. The file is hand-applied on the VM (`nginx -t && systemctl reload nginx`) — no deploy ships it.
