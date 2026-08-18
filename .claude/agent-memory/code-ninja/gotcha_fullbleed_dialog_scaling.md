---
name: gotcha-fullbleed-dialog-scaling
description: Two traps when a shadcn Dialog must host a fixed-px artwork (the certificate) — grid min-content inflates percentage-width wrappers, and a viewport-corner close button needs the content to span the viewport.
metadata:
  type: reference
---

Building a dialog whose card is a fixed-pixel design scaled to fit (the certificate modal,
`src/components/dashboard/training/CertificateModal.tsx`):

- **Never measure a `width: 100%` wrapper to compute the scale.** `DialogContent` is `grid`, so a
  1123px-wide child sets the column's min-content and the "100%" wrapper reports 1123 → scale 1 →
  the artwork overflows and gets clipped. Measure the element that actually carries the width cap
  (`w-full max-w-[1000px]` + `overflow-hidden`, which also zeroes the flex item's automatic minimum
  size) and scale from that.
- **A close button at the *viewport* corner cannot use `position: fixed` inside `DialogContent`** —
  its `translate-x-[-50%] translate-y-[-50%]` makes it the containing block for fixed descendants.
  Instead make the content itself span the viewport (`top-0 left-0 h-full max-w-none
  translate-x-0 translate-y-0 bg-transparent`, `showCloseButton={false}`) and position the button
  `absolute`. The `DialogOverlay` still dims correctly behind it.
- Because the content now covers everything, Radix sees no "outside" click: re-add dismissal with
  an `onClick` on the content that fires only when `event.target === event.currentTarget`.

**Why:** the modal shipped visibly broken (certificate spilling past the dialog, action button
hidden under the close button) precisely because of the first trap.

Related: [[reference-figma-worker-certificates]].
