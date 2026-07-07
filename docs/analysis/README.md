# LMS — Analysis & Rebuild Documentation

This directory (and its sibling [`../rebuild/`](../rebuild/)) is the output of a full-system audit of the Theraptly LMS conducted on **2026-07-05**. It exists in **three access tiers of the same findings** plus a full rebuild specification set.

## Analysis report — three tiers, one source of truth

| Tier | File | Audience | What it is |
|------|------|----------|------------|
| **Executive** | [`EXECUTIVE-SUMMARY.md`](./EXECUTIVE-SUMMARY.md) | Founders, buyers, compliance leads | One-page verdict, risk posture, the 8 things that must change before scale, and cost/effort framing. No code. |
| **Technical** | [`SYSTEM-ANALYSIS-REPORT.md`](./SYSTEM-ANALYSIS-REPORT.md) | Engineers, architects | The complete report: every subsystem, every finding with `file:line` evidence, severity, and a concrete fix. |
| **Shareable** | Published claude.ai Artifact (URL in the commit / PR) | Anyone, read-only | An interactive HTML rendering of the same findings for browsing outside the terminal. |

All three are generated from the **same finding register** ([`FINDINGS-REGISTER.md`](./FINDINGS-REGISTER.md)) — a flat, ID'd list (`F-001…`) so a finding can be referenced identically from a Jira ticket, a PR, or the exec deck.

## Rebuild documentation

See [`../rebuild/00-OVERVIEW.md`](../rebuild/00-OVERVIEW.md). The rebuild set specifies how to split the current Next.js monolith into a **retained Next.js frontend + a separate backend service + a separate worker service**, with data, AI, infrastructure, and HIPAA/SOC 2 specs detailed enough for an engineer or an agent to action.

## How this was produced

Eleven parallel read-only discovery/audit passes over the codebase (data model, auth & multi-tenancy, API surface, AI pipeline & jobs, frontend, infrastructure, billing & cross-cutting concerns, testing & quality, an adversarial OWASP security audit, a HIPAA + SOC 2 gap analysis, and a performance & scalability review), then cross-verified and deduplicated. Every claim is anchored to `file:line`. **No product code was modified** in producing this analysis.
