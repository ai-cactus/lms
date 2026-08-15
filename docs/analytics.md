# Product analytics (PostHog)

## The one thing to understand first

**PostHog is a third party operating without a BAA for this project.** It must never receive protected health information, a credential, or a direct identifier.

The integration is built so that it *cannot*, rather than trusted not to. If you are adding an event, the rules below are not style guidance — they are the control.

## What is enabled

| Capability | Status |
| --- | --- |
| Product analytics + funnels | On |
| Group analytics (per organization) | On |
| Feature flags + experiments | Planned |
| LLM analytics (v4.6 Vertex pipeline) | On |
| Error tracking | Planned |
| Autocapture | **Off, permanently** |
| Session replay | **Off**, in code and at the project level |
| Heatmaps / dead clicks / rageclick | **Off** |
| Surveys | Not used |

## How it is switched on

Enablement follows the same rule as OTel tracing (`src/instrumentation.ts`): **presence of a variable enables it, absence makes it a total no-op.**

With `NEXT_PUBLIC_POSTHOG_KEY` unset, the SDK never initialises, no request is made, and every helper short-circuits. Local dev, CI, vitest and the e2e build therefore carry no analytics and cannot leak. These variables are deliberately **not** in the required schema in `src/lib/env.ts`.

> ⚠️ `NEXT_PUBLIC_*` is inlined by Next.js at **build** time. The key must be passed as a Docker build arg (`Dockerfile`, and `build-args` in both deploy workflows). Setting it only in the runtime env file produces an image with analytics permanently dead and no error to show for it.

## Architecture

```
                         ┌─────────────────────────────┐
  browser ──capture()──▶ │ instrumentation-client.ts   │
                         │  before_send: DENY BY       │
                         │  DEFAULT + sanitise         │
                         └──────────────┬──────────────┘
                                        │  same-origin
                                        ▼
                              /ingest/*  (next.config.ts rewrites)
                                        │
  server ──captureServer()──▶ allowlist + sanitise ────┤
                                                       ▼
                                               PostHog Cloud US
```

**Two egress guards, because there are two transports.** The browser's guard is `before_send` in `instrumentation-client.ts`, which can *drop* an event rather than merely scrub it — necessary because it also sees events the SDK originates on its own (`$autocapture`, `$exception`, `$web_vitals`). `posthog-node` has **no `before_send`** (`PostHogOptions` omits it), so `captureServer()` in `src/lib/analytics/server.ts` enforces the allowlist itself and is the only server-side egress path.

**The reverse proxy is not optional.** PostHog's managed proxy is documented as not HIPAA-compliant. Routing ingest through `/ingest` also keeps the strict CSP in `next.config.ts` untouched, since everything is same-origin.

> ⛔ Never add `/ingest` to the matcher in `src/proxy.ts`. It would 401 unauthenticated ingest, and posthog-js does not surface transport failures — capture would appear to work while recording nothing. `src/proxy.test.ts` asserts this.

### Files

| File | Role |
| --- | --- |
| `src/lib/analytics/events.ts` | The event allowlist and property types. Start here. |
| `src/lib/analytics/sanitize.ts` | Path normaliser + property redactor. |
| `src/lib/analytics/client.ts` | Browser capture / identify / reset. |
| `src/lib/analytics/server.ts` | `posthog-node` singleton, `captureServer`, shutdown flush. |
| `src/lib/analytics/identity.ts` | Session → `{distinctId, organizationId}`. |
| `src/lib/analytics/llm.ts` | `$ai_generation` for the Vertex pipeline. |
| `src/lib/analytics/ai-context.ts` | AsyncLocalStorage run context for the AI pipeline. |
| `instrumentation-client.ts` | Browser init + the `before_send` guard. |

## Adding an event

1. **Declare it in `src/lib/analytics/events.ts`** — a name plus its exact property shape, with a comment saying *what question it answers*. An event that answers no question is noise you will pay to store.
2. **Add it to `ALLOWED_EVENTS`** in the same file. The runtime set and the type are two hand-maintained views of one list; `events.test.ts` fails if they drift. Forgetting this compiles fine and is then silently dropped at egress — the worst failure mode available.
3. **Capture it beside the existing `logger.info`** that already marks the moment. CLAUDE.md's logging table is effectively a ready-made event list.

```ts
const analytics = analyticsContextFrom(session);
if (analytics) {
  captureServer('course_published', () => ({ ... }), analytics);
}
```

**Pass a thunk whenever the values are derived** (counts, `.some()` over a relation, date arithmetic). `captureServer` never throws, but the *arguments* to it are ordinary code in the caller's hot path. A course must not fail to publish because a query shape changed under its telemetry.

## The rules

**Never send:**

- Email addresses, names, or any direct identifier. The person profile carries `userId` and `role` — nothing else.
- Free text of any kind: document content, course/lesson/question text, quiz answers, help-search queries, user-authored notes.
- Raw error messages or stacks. A Vertex error echoes the prompt; a Prisma error echoes column values. Use a fixed `reason` enum.
- Anything from a URL that has not been through `normalizePath()`.
- Raw headcounts. Use `toCountBand()` — "invited 47 staff" is close to a fingerprint for a specific customer.

**Safe to send:** record UUIDs (opaque), enum values from a closed vocabulary, counts that have been banded, durations, booleans, scores, and the organisation's business name.

**Why property values are primitives only:** an object or array is the natural channel for free text to escape. `sanitizeProperties()` drops non-scalars and reports only their key names.

## Paths and the invite token

`capture_pageview` is **off**. PostHog's automatic pageview sends `$current_url` verbatim, and this app's routes embed record ids — and at `/join/:token`, an **invite token, which is a credential**.

Pageviews are captured manually from `normalizePath()` output. Query strings are dropped wholesale rather than filtered: an allowlist would need maintaining in step with every new link, and the first missed parameter is a leak.

`normalizePath()` has two layers. Shape detection (UUID / numeric / high-entropy) is a heuristic backstop for routes nobody anticipated. The routes whose dynamic segment is *known* to be sensitive — `/join`, `/learn`, `/verify-certificate` — are handled by `ALWAYS_SCRUB_AFTER` and do not depend on the heuristic at all. **Add new sensitive routes there.**

## Group analytics

Every server capture attaches `groups: { organization: <orgId> }`. This is what makes the multi-tenant questions answerable: adoption per customer, org-level funnels, and churn cohorts such as *orgs with zero courses published in 30 days*.

Set group properties with `identifyOrganization()` on org creation and plan change only — group properties are overwritten wholesale, so a partial write clears the others.

## LLM analytics

Every Gemini call funnels through `callVertexAI()` in `src/lib/ai-client.ts`, so instrumenting that one function covers all five v4.6 stages, the PHI scanner, quiz grading, and the legacy actions.

- **Token counts are Vertex's own** (`usageMetadata`), which the response previously discarded. `estimateTokens()` is only a pre-flight budgeting guess.
- **Cost is not computed locally.** PostHog derives it from `$ai_model` + token counts, so a price change is a PostHog-side update and there is no local price table to drift.
- **`$ai_latency` is in SECONDS**, verified against PostHog's taxonomy (`"in seconds"`, example `0.361`). Call sites measure in ms; `captureGeneration` converts.
- **Identity comes from an AsyncLocalStorage run context** (`ai-context.ts`), bound once by the pipeline orchestrator. The five stage functions have five different positional signatures, and threading a telemetry argument through all of them to reach one leaf would touch far more code than the feature is worth. Each stage declares only its own name.
- The **Job id doubles as the trace id**, so stages A–E render as one PostHog trace and that trace ties back to the job row.

> ⛔ `$ai_input` and `$ai_output_choices` carry the prompt and completion. On this app the prompt **is** the facility's uploaded source document. They are not declared on the `$ai_generation` type, so sending one does not compile. `llm.test.ts` asserts the emitted property set exactly.

## Consent

No banner. `person_profiles: 'identified_only'` means anonymous marketing visitors never get a person profile — there is nothing to consent to until a user signs in and is deliberately identified. Behind login this is legitimate-interest B2B telemetry, disclosed on `/privacy`.

## Testing

Treat a failure in `src/lib/analytics/*.test.ts` as a **security regression**, not a broken unit test.

```bash
npx vitest run src/lib/analytics/   # the guards
npm run test                        # full suite
```

## Project-level settings (must be verified, not assumed)

Code-level flags are not sufficient on their own — several can be overridden by PostHog remote config. In the PostHog project:

1. **Session replay disabled** at project level.
2. **PostHog AI / Max disabled** — PostHog's docs state it is not covered by a BAA and sends data to third parties.
3. **Autocapture disabled** in project settings.
4. Data retention set appropriately.
5. `organization` group type created.

## Open items

- `toCountBand()` boundaries in `events.ts` are a placeholder (`TODO(bands)`). They should reflect the real distribution of facility sizes, or every cohort comparison built on them compares a group against itself.
