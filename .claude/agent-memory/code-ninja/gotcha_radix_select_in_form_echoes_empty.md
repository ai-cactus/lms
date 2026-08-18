---
name: gotcha-radix-select-in-form-echoes-empty
description: A shadcn/Radix Select inside a <form> echoes onValueChange("") when its value is set programmatically, silently wiping RHF rehydration
metadata:
  type: feedback
---

When a shadcn `Select` sits inside a `<form>`, Radix also renders a hidden native
`<select>` (`SelectBubbleInput`). On a **programmatic** value change it does
`select.value = newValue` and dispatches a native `change` event, whose handler calls
`onValueChange(event.target.value)`. If the matching `<option>` has not registered yet,
the DOM select falls back to `""`, so the echo delivers `""` — which immediately
overwrites whatever you just set.

**Why:** this silently broke step-3 onboarding rehydration. `reset()` from the draft put
the right value into RHF, the `Controller` rendered it once, and Radix's echo wrote `""`
straight back one render later. The symptom is a trigger stuck on its placeholder with
`data-placeholder` set, while every non-Select field on the same form rehydrates fine —
which misleadingly looks like an RHF `reset`/subscription-ordering problem. It is not:
`reset()` in a mount effect works correctly.

**How to apply:** whenever a Select's value can be set programmatically (draft
rehydration, "load saved values", prefill from an API) **and** it lives inside a form,
guard the handler — `onValueChange={(v) => { if (!v) return; field.onChange(v); }}`.
Safe because Radix forbids an empty-string `SelectItem` value, so `""` can only be the
echo, never a user selection. Verify with a jsdom render (needs a `ResizeObserver` stub);
logging `field.value` on each render exposes the set-then-revert sequence immediately.
