# UI Migration Pattern — Tailwind v4 + shadcn

The canonical conventions for migrating this LMS off CSS Modules / legacy components to Tailwind v4 + shadcn. Established by the **auth slice** (the reference implementation). Every later slice (dashboard, worker/learn, onboarding, system, profile) follows this guide.

**Spec:** `docs/superpowers/specs/2026-06-10-auth-ui-migration-design.md` ·
**Plan:** `docs/superpowers/plans/2026-06-10-auth-ui-migration.md`

---

## 0. Foundation (already in place — do not re-introduce the bugs it fixed)

`src/app/globals.css` defines the full **shadcn semantic token set** (`--primary-foreground`, `--input`, `--ring`, `--muted(-foreground)`, `--accent(-foreground)`, `--secondary(-foreground)`, `--destructive(-foreground)`, `--card`, `--popover`) in `:root`, mapped in `@theme inline` to the Theraptly palette. shadcn components (button, input, dialog, table…) render correctly only because of this. If you add a shadcn component that needs a new token, add it to **both** `:root` and `@theme inline`.

All base/reset/element rules live inside **`@layer base`**. Tailwind v4 puts utilities in `@layer utilities`; **unlayered CSS beats any layer regardless of specificity**, so an unlayered `* { padding: 0 }` would silently kill every `p-*`/`m-*` utility. Never add unlayered global element/reset rules — put them in `@layer base`. Legacy CSS Modules stay unlayered (they still win where used, so they're unaffected during incremental migration).

## 1. Component decisions

| Need | Use | Notes |
|---|---|---|
| Button | `@/components/ui/button` | Has `loading` prop (spinner + `aria-busy` + disabled). Use `className="w-full"` (no `fullWidth`). Variants: `default` (purple), `secondary` (light pill — used for the Microsoft button with `rounded-full`), `outline`, `ghost`. |
| Text/email input | `@/components/ui/input` | Bare. Optional `startIcon={<Mail />}` (lucide) renders a left icon + left padding. |
| Password input | `@/components/ui/password-input` | `Input` + show/hide eye toggle. Supports `startIcon` (e.g. `<Lock />`). |
| Label + error + helper | `@/components/ui/field` (`Field`) | Wraps a **single** control child; injects `id`/`aria-invalid`/`aria-describedby` and renders the error/helper. **Client components only** (see §5). |
| One-time code (OTP) | `@/components/ui/otp-input` (`OtpInput`) | Segmented digit boxes; `value` is the joined string; `onComplete(value)` fires when full. Auto-advance, backspace-back, paste-fill. |
| Alerts / banners | `@/components/ui/alert` (`Alert`) | `variant: success | error | warning | info`, `title` + children, lucide icon per variant. Replaces all inline-styled banners. |
| Checkbox | `@/components/ui/checkbox` | Radix — use `onCheckedChange={(c) => ...(c === true)}`, **not** `onChange`. |
| Split auth layout | `@/components/auth/AuthShell` | Centered `max-w-[420px]` form column (left) + `AuthHeroSlider` (right, `lg+`). |

## 2. Hard rules

- **No `.module.css`.** Convert layout/spacing to Tailwind utilities; delete the module when the last importer is gone.
- **No inline `style={{}}`** for presentation. (Functional exceptions like framer-motion props are fine.)
- **No inline `<svg>`.** Use `lucide-react` icons.
- **Theme utilities, not raw hex:** `text-foreground`, `text-text-secondary`, `text-text-tertiary`, `text-primary`, `text-error`/`text-success`/`text-warning`, `bg-background`, `bg-background-secondary`, `border-border`, `bg-primary/10`, etc.
- **No `console.*`** — use `logger` from `@/lib/logger`.
- **Responsive:** every page must work at ~375 / ~768 / desktop. Stack multi-column rows on mobile (`grid-cols-1 sm:grid-cols-2`).

## 3. Canonical snippets

**Form field**
```tsx
<Field label="Email" error={errors.email}>
  <Input
    type="email"
    name="email"
    placeholder="Enter your email address"
    value={email}
    onChange={handleChange}
    autoComplete="email"
    startIcon={<Mail aria-hidden="true" />}
  />
</Field>
```

**Alert**
```tsx
<Alert variant="error" className="w-full" title="Access Denied">
  You do not have authorization to log in with this role.
</Alert>
```

**Submit button**
```tsx
<Button type="submit" size="lg" className="w-full" loading={isPending}>Log in</Button>
```

**Microsoft / social (secondary pill)**
```tsx
<Button type="button" variant="secondary" className="w-full gap-3 rounded-full" onClick={handleMs} loading={loading}>
  <Image src="/icons/microsoft.svg" alt="Microsoft" width={20} height={20} />
  <span>Log In with Microsoft</span>
</Button>
```

**Divider**
```tsx
<div className="flex w-full items-center gap-3 text-xs text-text-tertiary">
  <span className="h-px flex-1 bg-border" /><span>or continue with email</span><span className="h-px flex-1 bg-border" />
</div>
```

## 3a. Tables & row actions

- Use the shadcn `Table` family (`@/components/ui/table`) — already themed (header `bg-[#f8f9fb]`, dashed row borders, hover). Header `<TableHead>`, body `<TableCell>`.
- **Responsive (match Figma): collapse, don't scroll.** Hide secondary columns on mobile with `hidden md:table-cell` on both the `<TableHead>` and its `<TableCell>`s, leaving the primary column. Surface key secondary info under the primary cell on mobile only (e.g. `<span className="text-xs text-text-secondary md:hidden">{level}</span>`). Make the row clickable for navigation so hidden actions stay reachable.
- **Kebab / row actions:** use `RowActionsMenu` (`@/components/ui`) — pass `actions: RowAction[]` (`label`, optional `icon` lucide, `href` or `onSelect`, `variant: 'destructive'`, `separatorBefore`). Put it in a right-aligned `<TableCell onClick={(e) => e.stopPropagation()}>` so it doesn't trigger row navigation. Do NOT hand-roll kebab triggers/menus — replace inline 3-dot SVG + `DropdownMenu` blocks with `RowActionsMenu`.
- Table search inputs: shrink the global 56px Input with `className="h-11"`.
- Reference implementations: `MyCoursesTable` (display table) and the `/styleguide` "Table + row actions" section.

## 3b. Modals / dialogs

Replace legacy `Modal` (and hand-rolled `fixed inset-0` overlays) with the shadcn **`Dialog`** family (`@/components/ui/dialog`) — accessible (focus trap, ESC, overlay click), themed, with a built-in close button. Canonical shape:

```tsx
<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
    <form action={action} className="flex flex-col gap-6">
      {/* …fields… banners via <Alert> … */}
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isPending} disabled={!ready}>Save</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

- `onOpenChange(false)` fires on ESC / overlay / the ✕ — route it to the existing `onClose`.
- **Preserve form gating.** Native `required`/HTML validation does NOT carry over when you swap a native `<input type="checkbox" required>` for the shadcn `Checkbox` (Radix renders a `<button>`). Mirror the gate with controlled state and fold it into the submit button's `disabled` (e.g. `disabled={!file || !agreed}`). Pair `Checkbox id=…` with `<label htmlFor=…>` (the Radix root is a labelable `<button>`, so the label still toggles it).
- Reference: `documents/upload-modal.tsx`, `dashboard/Header.tsx` (logout confirm). The pre-Dialog `CoursesListClient` rename modal uses a hand-rolled overlay — fine where it is, but new/ported modals should use `Dialog`.

## 4. Per-page migration procedure

1. Read the page and its `.module.css`. Read an already-ported sibling as a reference.
2. **Preserve all logic byte-for-byte** — state, handlers, server actions/fetches, validation, redirects, field `name=`, `autoComplete`, `Suspense`, storage keys. Only JSX + imports change.
3. Swap legacy imports → `Button`/`Input` from their shadcn paths; add `Field`/`PasswordInput`/`Alert`/`OtpInput`/`AuthShell` as needed. Keep `Logo` from `@/components/ui`.
4. Wrap content in `<AuthShell>` (split forms) or a centered card (status/standalone pages). Convert classes to Tailwind utilities.
5. Replace legacy `<Input label error>` → `<Field label error><Input/></Field>`; passwords → `<PasswordInput>`; banners → `<Alert>`; OTP → `<OtpInput>`.
6. Delete the page's `.module.css` (only if no other file imports it).
7. Gate: `npm run lint && npx tsc --noEmit` clean; `grep` confirms no `module.css`/`style={{`/`console.` left.
8. **Verify rendering yourself** before handing off: `npx tsx scripts/shot.ts <route>` screenshots the page at mobile/tablet/desktop against the dev server (`:3005`). Compare against the THERAPTLY Figma intent. If layout/flow is ambiguous, ask for the specific Figma frame.

## 5. Gotchas (learned the hard way)

- **`Field` is client-only.** It uses `React.cloneElement` to inject aria props. In a **Server Component**, a `startIcon` `Input` passed to the client `Field` gets the aria props on the wrapper `<div>` instead of the `<input>` (an RSC `cloneElement` quirk). All interactive forms are `'use client'` anyway, so this is a non-issue in practice — but never use `Field` in a Server Component. The `/styleguide` page is `'use client'` for this reason.
- **`includes('')` on a string is always `true`** — don't use it to test "all filled". Use a length check.
- **Controlled rapid input races** (OTP/autofill): keep a synchronously-updated `useRef` mirror of the value so a burst of keystrokes doesn't read a stale prop. (See `OtpInput`.)
- **shadcn `Checkbox`** uses `onCheckedChange(checked)` — adapt legacy `onChange={e => e.target.checked}` accordingly.

## 6. Retiring a legacy component

The barrel `src/components/ui/index.ts` still exports legacy `Button`/`Input`/`Checkbox`/`Select`/`Modal` for unmigrated slices. Flip a name to the shadcn version **only when `grep -rn "from '@/components/ui'"` shows no remaining consumer relies on the legacy API**. Until then both coexist (legacy has its own CSS-module styling, unaffected by the shadcn theme).
Known remaining legacy consumers as of the auth slice: `src/components/auth/MfaSettings.tsx` (legacy `Button`), plus dashboard/worker/onboarding/system slices.

## 7. Next slices (recommended order)

dashboard → worker/learn → onboarding → system → profile.
Recommended next-level gate once a slice stabilizes: add **Playwright visual-regression snapshots** (deferred in the auth slice) so future changes can't silently break layouts.

## 8. New shared primitives produced by the auth slice

`Field`, `PasswordInput`, `Alert`, `OtpInput`, `AuthShell`, plus `Button` `loading` and `Input` `startIcon`. All are unit-tested under `src/components/ui/*.test.tsx` and showcased on `/styleguide`.
