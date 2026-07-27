---
name: reference-figma-course-wizard
description: Where the Course Creation wizard frames actually live in Figma LMS v2 (they are NOT in one COURSE CREATION section) and the frame→step map
metadata:
  type: reference
---

There is **no "COURSE CREATION" section** in Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)". The page has only two top-level sections (`ADMIN USERTYPE` `12716:27429`, `WORKER USERTYPE` `12716:27430`); everything else is a nested section named generically `ADMIN` / `ADMINS`, **or a loose frame parented straight to the page**. Node `12539:30421` (often cited as "COURSE CREATION") is actually the generic section named **ADMIN**.

The wizard frames are split across two generations and two parents:

| node | name | maps to |
|---|---|---|
| `12539:30822` / `12539:30848` / `12539:30913` / `12568:46988` | LMS - 25 / 35 / 36 / 107 | **Step1Category** (closed / open / open-custom / filled) |
| `12539:31277` | LMS - 41 | **Step3Details** ("Course Details") |
| `12539:31364` | LMS - 29 | **Step4Quiz** ("Course Quiz") |
| `12539:31429` | LMS - 30 | **Step5Review generating state** ("Your course is being created…") |
| `12539:31764` / `12539:31869` / `12796:37264` / `12699:20343` | LMS - 32 / 86 / 118 / 117 | **Step5Review** content ("Review Course Content", notes/slides/sources) |
| `12539:32156` | LMS - 37 | **Step6QuizReview** ("Review Quiz Questions") |
| `12539:32277` | LMS - 33 | **Step7Publish** ("Assigning & Publish") — matches the implemented feature set |
| `13557:37461` | LMS - 147 | **ConfirmPublishModal** |
| `13969:50221` | LMS - 160 | **CourseSuccessModal** (old) |
| `14109:62379` | LMS - 194 | **CourseSuccessModal** (new, simpler green-check card) |
| `14060:83778` / `14106:44063` / `14106:44227` | LMS - 178 / 189 / 190 | newer Step 6 concept, quiz editor beside a player preview |
| `14060:84709` | LMS - 182 | newer Step 7 concept — **drops** roles/individual-invite tabs, reminders and recurring toggle, so it is NOT implementable without losing behaviour |

**Frames that are designs for features the app does not have** — do not "reconcile" a step to them: `14057:68995` (LMS-172, "How would you like to create this training?"), `14060:82715` (LMS-175, same), `14059:70249` + `14106:46608` (LMS-173/191, "Choose a Prebuilt Course"), `14060:78339` (LMS-174, "Select a Course"), `13967:47752`/`13967:47805`/`13968:49522` (LMS-156/153/159, "Create Course Modules" — a multi-module Step 2 that replaces the current document picker), `13464:36827` (LMS-124, "Who is this course for?"). The Figma wizard is **9 steps**; the app is **7**.

The frames named LMS - 163/164/165/166/167/169/179/180 are the courses list, course detail and the standalone learn player — not wizard screens.

**Geometry the wizard frames agree on** (1:1 CSS px, verified against the running app):
header `h-[106px]` with a `w-[218px]` logo cell (`border-r border-black/10`), an 8px progress rail *below* the header (track `#dbdbdb`, fill `rounded-r-[210px]`), step label 19px medium `#3e3e3e`, "Exit" 20px bold `#0d0d12` with `pr-[60px]`. Content columns: **step 1 = 880 (`px-[280px]`, `pt-[170px]`, field block inset a further 120)**, **form steps = 1080 (`px-[180px]`, `pt-[90px]`)**, **steps 6/7 = 1200 (`px-[120px]`)**. Controls are `h-[56px] rounded-[12px] border-[1.5px] border-[#e5e7ea]` with 18px `#0a0a0a` text and `#979797` placeholders; two-column rows are a fixed `w-[400px]` label (16px `#666d80`) + flex-1 control; titles are 36px bold `#383838` (`tracking-[-0.72px]`, `leading-[48px]`) over a 16px `#424242` subtitle. Buttons are 56px, `rounded-[12px] px-[40px] text-[18px] font-semibold` — Back outlined `#d2d5db`/`#454353`, Next filled.

See [[figma-to-css-scale]] (these older `12539:*` frames are 1:1 in **both** axes — the ÷1.12 rule does not apply to them) and [[reference-figma-lms-v2]].
