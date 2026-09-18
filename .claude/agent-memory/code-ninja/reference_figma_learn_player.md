---
name: reference-figma-learn-player
description: Where the learner /learn/[id] player frames live in Figma LMS v2, the slide-thumbnail rail's exact geometry, and the two things the design does NOT specify
metadata:
  type: reference
---

The standalone learner player (`/learn/[id]`) is designed in file `cySAabdYLDKzwbs88owBHn`,
page `12539:30414` ("🧩 LMS v2"), as **loose frames parented straight to the page** — not
inside `ADMIN USERTYPE` / `WORKER USERTYPE`. See [[reference-figma-lms-v2]] for why frame
numbers are not a reliable index.

| node | name | is |
|---|---|---|
| `14042:50595` | LMS - 166 | **learner player, slides view, LEFT thumbnail rail** (rail node `14042:50630`) |
| `14042:50503` / `14044:47851` | LMS - 165 / 167 | notes/doc view, right-hand 353px "Widget" panel, no rail |
| `14044:48348` / `14060:83974` | LMS - 169 / 180 | same player with the thumbnails on the **right**, in a "Table of Content" card (180 = admin-preview variant) |
| `14060:83867` | LMS - 179 | video lesson view; its Slides tab uses a smaller rail (86.68 × 55.03 thumbs) |
| `14040:43887` / `14040:48934` | LMS - 163 / 164 | courses list / course detail (both carry the 280px admin Nav) |

**Rail geometry (LMS - 166, and byte-identical in the wizard's LMS - 86 / 118):** panel
**120.03px** wide with no padding, no border and no background — the boxes *are* the panel;
thumbnails **120.03 × 76.20** (aspect **1.575:1**, i.e. ~16:10); vertical gap **~14.7px**
(pitch 90.9); ~26.7px from the rail to the main slide, which is 952 × 587.

**Two things the frame does NOT have, so they are decisions, not reads:** there is **no slide
number** anywhere (no badge, no gutter digit, no text node carrying an index) and **no
selected state** — all thumbnails are identical white/hairline, and the current slide is
signalled only by the big slide beside them. `CourseSlide.tsx` and `WizardReviewSlides.tsx`
both add a number and a selected treatment on top of the frame; keep them in step.

**How to apply:** the learner rail and the wizard review rail are the *same* designed
component, so a change to one should be mirrored in the other rather than diverging.
