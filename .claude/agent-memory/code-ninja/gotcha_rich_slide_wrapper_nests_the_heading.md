---
name: gotcha-rich-slide-wrapper-nests-the-heading
description: The authored slide unit is the .rich-slide div, NOT the h2/h3 — the heading is nested inside it, so heading-based splitting tears the wrapper open and drops its styling classes
metadata:
  type: project
---

`lesson.slideContent` is produced by `slidesV46ToHtml`
(`src/components/dashboard/courses/steps/GenerationController.tsx`), which emits
per slide, joined with `.join('')` and no separator:

```html
<div class="rich-slide slide-type-tell">
  <span class="slide-type-badge slide-type-badge-tell">CONCEPT</span>
  <h3 class="slide-heading">Title</h3>
  …body…
</div>
```

**The `<h3>` sits INSIDE the `.rich-slide` wrapper.** Two consequences that are
only visible by reading the generator and `src/lib/slide-splitter.ts` together:

1. `splitSlideContent`'s heading regex matches that inner `<h3>`, so it cuts
   **across** the div boundary. The wrapper's opening tag plus the badge `<span>`
   land in the *previous* fragment, and each body runs on through
   `</div><div class="rich-slide …">` into the next slide's opener. **Every
   reading page is unbalanced HTML** — it renders only because the browser
   auto-closes tags in `dangerouslySetInnerHTML`. That is shipped, working
   behaviour; do not "fix" it.
2. Reconstructing a heading as `<h3>${text}</h3>` from `extractHeadingText`
   **drops `class="slide-heading"`**, which drives styling
   (`CourseSlide.tsx:50-53`). Any round-trip must carry the heading markup
   verbatim, never rebuild the tag.

**Why it matters:** a plan that assumes h2/h3 is the authored slide boundary is
wrong, and an editor built on it corrupts content on the first save. PR 3a of the
slide-editor plan was scoped this way and had to be re-scoped mid-flight.

**How to apply:** for any editing/round-trip work on slide content, the unit is
the top-level `.rich-slide` div. Locate it with a balanced `<div>` depth scan over
the raw string, **not** a DOM parse — parse/re-serialise normalises attribute
quoting and entity escaping, which silently rewrites authored content and defeats
byte-exact fidelity. Lesson HTML with no `.rich-slide` markup at all (legacy
lessons, the `slideContent || content` article fallback) is a second real
population and needs its own branch. See `splitIntoEditableSections` in
`src/lib/slide-splitter.ts`.

Related: [[gotcha_coursepreview_is_shared_with_worker]].
