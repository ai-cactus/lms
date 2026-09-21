---
name: gotcha-courserail-is-quiz-views-only
description: CourseRail is NOT the lesson-view module navigator — showSharedLayout renders it on quiz views only, so it is never co-mounted with AdminSlideEditor; the ToC in CourseArticle is what navigates modules
metadata:
  type: project
---

`LearnClient.tsx` gates **CourseRail, its mobile "Open module list" toggle and
the whole top bar** (breadcrumb + ARTICLE/SLIDE toggle) behind one flag:

```ts
const showSharedLayout = isQuizIndex || (quizStep === 'review' && quizResults);
```

Quiz views only. Reading `CourseRail.tsx` alone is misleading: it renders a
module list, an Exit button and a QUIZ entry, and `handleRailSelect` has a
"Standard Lesson Selection" branch — all of which suggests it is the lesson-view
navigator. It is not. On lesson views the module navigator is
**`CourseArticle`'s Table of Contents** (`onSelectModule` → `handleRailSelect`),
and it exists only in the article view.

**Consequence:** `AdminSlideEditor` and `CourseRail` are never mounted at the
same time. With the editor open the only controls on screen are
`["View as Notes", "Save Slides", <deck slide thumbnails>, "Back", "Next"]` —
all of which the editor already guards for unsaved edits. A plan to "guard
rail navigation against discarding slide edits" is guarding an interaction that
cannot happen; pinned instead by the invariant test in `LearnClient.test.tsx`
("module navigation is unreachable while the editor is open"), which reddens if
`showSharedLayout` ever widens.

**How to apply:** before wiring anything to the rail, render the surface and
look — `fireEvent.click(getByRole('button', {name: 'View on Slides'}))` on an
admin payload, then dump `screen.getAllByRole('button')`. Cheaper than reading
1300 lines, and it caught a plan built on the opposite assumption. Note the
learn-view test file still calls the ToC "the module rail" in one place, which
is where the confusion is seeded.

Still genuinely unguarded, and out of that scope: the **browser Back button**.
App Router handles popstate as a client navigation, so `beforeunload` never
fires and unsaved deck edits go silently.

Related: [[gotcha_coursearticle_hasfulllayout_gates_quiz]],
[[gotcha_courserail_unlockedindex_conflates_quiz]],
[[gotcha_rich_slide_wrapper_nests_the_heading]].
