# Course Overview — Rich-Text Formatting

**Date:** 2026-06-18
**Branch:** `feat/overview-format`
**Status:** Design approved, pending spec review

## Problem

The course **Overview** field (entered on the `/system/video-courses` form) holds a
single blob of plain text containing logical sections — "About" / "Course Overview",
"What You'll Learn", and "Table of Content" — with headings and list items. Today it is
stored as a plain string and rendered with `whitespace-pre-line`, so headings and lists
appear as undifferentiated paragraphs. Authors need the headings, the "What You'll Learn"
items, and the "Table of Content" heading + items to render as real headings and bulleted
lists.

## Decision

Upgrade the **input** to a rich-text editor and the **display** to a sanitized HTML
renderer. The author marks headings and lists explicitly; we store HTML and render it.
We do **not** parse plain text heuristically.

This was chosen over (a) a render-time parser of known section headings and (b) a
markdown-convention approach, because the editor is the most reliable and gives authors
direct control, and the project already ships `react-quill-new` and a DOMPurify
sanitizer.

Accepted trade-off: existing plain-text overviews will not auto-format; they re-format
only when an author re-edits that course. A backward-compat guard keeps them readable in
the meantime.

## Current State (verified)

- **Storage:** `Course.overview String?` (`prisma/schema.prisma`). Remains a `string`.
- **Only display site:** `src/components/dashboard/training/CoursePreview.tsx:257-264`
  (renders `<h2>Course Overview</h2>` + a `whitespace-pre-line` `<p>`).
- **Input:** plain `<textarea name="overview">` in
  `src/app/system/video-courses/VideoCourseForm.tsx:213-222`. This form is shared by both
  create (`VideoCoursesClient`) and edit (`EditVideoCourseClient`) flows.
- **Existing editor pattern to reuse:** `src/components/courses/AdminLessonEditor.tsx`
  (dynamic `ReactQuill`, `quill.snow.css`, toolbar, `sanitizeHtml` + `dangerouslySetInnerHTML`).
- **Sanitizer:** `src/lib/sanitize.ts` — `sanitizeHtml()` already allows `h1`–`h6`, `p`,
  `ul`/`ol`/`li`, `strong`/`em`/`b`/`i`/`u`, `a`, `blockquote`, `br`, `hr`. **No change
  needed.**

## Changes

### 1. Input: rich editor in `VideoCourseForm.tsx`

Replace the `overview` `<textarea>` with a dynamically-imported `ReactQuill`, mirroring
`AdminLessonEditor.tsx`:

- `const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false })`
- `import 'react-quill-new/dist/quill.snow.css'`
- Toolbar modules:
  ```
  toolbar: [
    [{ header: [2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ]
  ```
  (Link included — the sanitizer already permits `<a>`; harmless and useful.)
- Keep `value={overview}` / `onChange={setOverview}` wiring unchanged. The `name="overview"`
  hidden-field semantics, create flow, and edit flow are all preserved because they read
  from the same `overview` state.
- Apply the same `[&_.ql-*]` arbitrary-variant styling wrapper used in `AdminLessonEditor`
  so the editor matches the form's look.

### 2. Empty-state helper

Quill emits `<p><br></p>` for an empty editor. Add an `isEmptyHtml(html: string): boolean`
helper (strip tags/`&nbsp;`/whitespace, test for emptiness). Use it where the form
currently does `values.overview.trim() || undefined` (in `VideoCoursesClient`,
`EditVideoCourseClient`, and `api/system/video-courses/route.ts`) so an "empty" rich-text
overview is still stored as `undefined`/null rather than `<p><br></p>`.

### 3. Display: shared `RichTextContent` component

New `src/components/courses/RichTextContent.tsx`:

```tsx
export function RichTextContent({ html, className }: { html: string; className?: string }) {
  if (!containsHtml(html)) {
    // Backward-compat: legacy plain-text overview
    return <p className="whitespace-pre-line ...">{html}</p>;
  }
  return (
    <div
      className={cn('prose-overview', className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
```

- `containsHtml()` = simple tag detection (e.g. `/<[a-z][\s\S]*>/i`).
- `prose-overview` = Tailwind arbitrary-variant utilities styling `h2`, `h3`, `ul`/`ol`,
  `li`, `strong`, `a`, paragraph spacing — same technique as `AdminLessonEditor`'s
  `[&_...]` classes (no dependency on the typography plugin).

### 4. Wire into `CoursePreview.tsx`

In the Course Overview card (lines 257-264), replace the raw `<p>{course.overview || course.description}</p>`
with `<RichTextContent html={course.overview || course.description || ''} />`. Keep the
hardcoded `<h2>Course Overview</h2>` section label and the separate `objectives[]`
"What You'll Learn" list unchanged.

## Out of Scope

- No DB migration; `overview` stays a `string` column.
- No render-time text parser / heuristics.
- No changes to `objectives[]` or the module-driven "Course Contents" section.
- No backfill of existing plain-text overviews (they render via the compat guard until
  manually re-edited).

## Testing

- **Manual:** create a video course with headings + bullet lists in the editor; confirm
  `CoursePreview` renders real `<h2>/<h3>/<ul>/<li>`. Edit an existing course and confirm
  round-trip. Submit an empty overview and confirm it stores as null/undefined.
- **Compat:** a course whose `overview` is the legacy plain-text sample still renders
  readably (falls through to `whitespace-pre-line`).
- **Security:** paste a `<script>`/`onclick` payload; confirm `sanitizeHtml` strips it.

## Files Touched

| File | Change |
| --- | --- |
| `src/app/system/video-courses/VideoCourseForm.tsx` | textarea → ReactQuill |
| `src/components/courses/RichTextContent.tsx` | **new** shared renderer |
| `src/lib/html.ts` (or colocated) | `isEmptyHtml` / `containsHtml` helpers |
| `src/components/dashboard/training/CoursePreview.tsx` | use `RichTextContent` |
| `src/app/system/video-courses/VideoCoursesClient.tsx` | use `isEmptyHtml` |
| `src/app/system/video-courses/[courseId]/edit/EditVideoCourseClient.tsx` | use `isEmptyHtml` |
| `src/app/api/system/video-courses/route.ts` | use `isEmptyHtml` |
