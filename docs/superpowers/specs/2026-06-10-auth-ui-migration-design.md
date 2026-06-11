# Auth UI Migration — Design Spec

**Date:** 2026-06-10
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/auth-ui-migration`

## Context

The LMS (TherDay/"THERAPTLY") is a regulated healthcare learning platform built on
Next.js 16 (App Router), React 19, Tailwind v4, and shadcn (new-york, slate base) over radix-ui.
A migration from vanilla CSS / CSS Modules to Tailwind + shadcn is **in progress**: of 186 `.tsx`
files, 125 still import `.module.css`, and 81 `.module.css` files remain.

This spec covers the **first slice — the auth surface** — which doubles as the **reference
implementation**. It must establish the canonical, secure, production-ready pattern that every
later slice (dashboard, worker, onboarding, system) follows. The user verifies every page
personally.

### Design source
Figma file "THERAPTLY". Tokens already extracted to `src/style/design-tokens.ts`; theme
CSS variables mapped in `src/app/globals.css`. `FIGMA_ACCESS_TOKEN` is configured. Fidelity bar:
**Figma as direction + judgment** (honor tokens/components/layout intent; use sensible defaults
where Figma is missing/ambiguous).

### The migration crux (why auth is a good first slice)
- Two parallel component systems coexist: shadcn `src/components/ui/*.tsx` and legacy
  CSS-module `src/components/ui/legacy/*`. The barrel `ui/index.ts` currently exports the **legacy**
  `Button`/`Input`/`Checkbox`/`Select`/`Modal`.
- Auth pages import `Button`/`Input` from `@/components/ui` → resolve to **legacy**.
- Layout/spacing lives in `.module.css`; one-off states (success/error/session-expired banners) are
  hand-built with ~40-line inline `style={{}}` blocks and inline SVGs, duplicated ~3× in login alone.
- Legacy components carry non-shadcn props with no current shadcn equivalent: Button
  (`loading`, `fullWidth`), Input (`label`, `error`, `helperText`, animated password show/hide,
  `leftIcon`/`rightIcon`).

## Strategy — Approach C: extract-as-you-go + documented convention

Port auth pages to Tailwind + shadcn, and extract a shared component **only when a second usage
proves it's needed** (YAGNI). Codify the resulting conventions in a short migration pattern guide
plus the live `/styleguide` page. Chosen over (A) page-by-page direct port (duplicates shared
concerns) and (B) component-library-first (over-builds before real needs are known).

## Section 1 — Component decisions (canonical primitives)

| Concern | Decision | Rationale |
|---|---|---|
| **Button** | Extend existing shadcn `button.tsx` with a thin `loading?: boolean` prop (lucide `Loader2` spinner, `aria-busy`, disabled while loading). Drop `fullWidth` → use `className="w-full"`. | `loading` is near-universal on submit buttons. `fullWidth` is one utility — no prop needed. |
| **Input** | Keep shadcn `Input` **bare** (shadcn idiom). | Composition over fat components. |
| **Label + error + helper** | New `Field` wrapper (`label` + children + `error`/`helperText`; wires `id`/`aria-describedby`/`aria-invalid`). | Replaces legacy Input's built-in label/error. One a11y-correct pattern for every form. |
| **Password show/hide** | New `PasswordInput` (composes `Input` + lucide `Eye`/`EyeOff`, keeps show/hide a11y). Use a CSS transition, not framer-motion, on the leaf input. | Genuinely reused; avoid pulling framer-motion into a leaf input. |
| **Alert banners** | New shadcn `alert.tsx`, `variant: success \| error \| warning \| info`, lucide icon per variant. | Kills the ~3× duplicated inline-`style` banner blocks. |
| **Auth shell** | New `AuthShell` layout (split-screen: form pane + `AuthHeroSlider`), replacing `(auth)/layout.module.css` + each page's `.container/.formSection`. | Every auth page repeats this split layout. |
| **Legacy `Button`/`Input`/`Checkbox`** | Repoint `ui/index.ts` barrel to shadcn versions **only after** all auth consumers are migrated. Leave legacy files until the whole app is off them. Flip the barrel per-component when the last consumer is gone. | Other slices (dashboard, onboarding) still import legacy — don't break them. |

**Pattern principle:** no `.module.css`, no inline `style={{}}`, no inline SVG. Layout = Tailwind
utilities; icons = lucide; states = shadcn components; colors via the existing CSS-variable theme.

## Section 2 — Slice scope & per-page plan

**In scope:** `src/app/(auth)/*` (login, signup, signup/role-selection, forgot-password,
reset-password, verify-email, verify, mfa/verify, mfa/recover), `(auth)/layout.tsx`,
`src/app/verify-2fa`, `src/app/join/[token]`, and `src/components/auth/*`.

**Order of work:**
1. **Foundation components first:** `Field`, `PasswordInput`, `alert.tsx`, `AuthShell`, Button
   `loading`. Each added to the `/styleguide` page for isolated verification before any page consumes it.
2. **Port pages, lowest-risk → highest:** layout/shell → forgot-password → reset-password →
   verify-email/verify → mfa/* + verify-2fa → signup + role-selection → **login last**
   (OAuth, 3 alert states, action-state redirects).
3. **Per page:** swap legacy→shadcn primitives, convert `.module.css` → Tailwind utilities, replace
   inline-styled banners with `<Alert>`, delete the orphaned `.module.css`.
4. **Cleanup:** confirm no auth file imports legacy `Button`/`Input`; leave barrel as-is (other
   slices still use legacy); note auth is clean.

**Hard invariants (regulated app — behavior held byte-for-byte):** no change to server actions,
validation rules (`PASSWORD_MIN_LENGTH`), field `name=` attributes, `autoComplete`, redirect
targets, `useActionState` wiring, or `signIn` calls. No new runtime deps. No `console.*` (use
`logger` from `src/lib/logger.ts`). Responsive at mobile/tablet/desktop for every ported page.

## Section 3 — Verification & deliverable

**Verification (user-run):** for each ported page, a focused checklist — route, states to exercise
(e.g. login: empty-submit error, wrong password, OAuth-error banner, session-expired banner,
success redirect), and three breakpoints (~375px / ~768px / desktop) checked against THERAPTLY
Figma intent. Before handoff, each page passes `npm run lint`, `npm run build`, and `tsc` clean,
and existing Playwright tests still pass. No visual-regression snapshots in this slice (noted as the
recommended next-level gate).

**Reusable-pattern deliverable — `docs/ui-migration-pattern.md`:**
- Component decision table (when to use `Field` vs bare `Input`, `Alert` variants, Button `loading`,
  layout shells).
- Rules: no `.module.css` / no inline `style` / no inline SVG / lucide icons / theme tokens.
- Copy-paste reference: canonical form page (label+input+error+submit) and canonical alert.
- Per-page migration procedure + per-slice verification checklist template.
- How to retire a legacy component (flip the barrel only when the last consumer is gone).

Plus the live `/styleguide` page extended with the new primitives.

Every later slice then reduces to: "follow `docs/ui-migration-pattern.md`."

## Out of scope
- Non-auth slices (dashboard, worker, learn, onboarding, system, profile) — future slices.
- Flipping the `ui/index.ts` barrel for components still consumed outside auth.
- Visual-regression snapshot infrastructure.
- Any auth/behavior/logic changes.
