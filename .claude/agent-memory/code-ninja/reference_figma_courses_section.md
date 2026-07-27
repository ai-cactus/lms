---
name: reference-figma-courses-section
description: Frame→page map for the Figma COURSES section (12539:34563), and the shared LMS-v2 table/card/pagination token set the redesign uses everywhere
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)", section **COURSES = `12539:34563`**. Frames left→right on canvas (name numbers are NOT chronological within the section):

| node | name | what it actually is |
|---|---|---|
| `14833:48959` | LMS - 206 | `/dashboard/courses` **empty state** ("No courses yet") — no header Create button, illustration + CTA inside the card |
| `13495:161415` | LMS - 140 | `/dashboard/courses` **populated list** + kebab menu open — the real list-page target |
| `12539:34940` | LMS - 61 | `/dashboard/training/courses/[id]` **course detail** (stat cards + enrolled-staff table) |
| `12539:36068` `12539:35797` `12814:51348` | LMS - 64 / 76 / 119 | dark course-player / assign overlays (CoursePlayer subsystem) |
| `12539:35190` `12539:35386` | LMS - 99 / 100 | tall quiz-result pages (pass / fail) |
| `12903:38683` `14003:117427` `14284:43681` | LMS - 122 / 162 / 196 | **certificates** list + certificate modal — NOT courses pages |

Mobile 375 frames in this section are all named "web sign up"; `13362:33444` is the **dashboard My-Courses widget**, not the courses list page. **There is no mobile frame for the courses list page, the course-detail page, `/dashboard/courses/queue`, or `/dashboard/courses/[id]/mapping`** — the last two render outside the dashboard shell entirely and have no design at all.

**Shared LMS-v2 widget tokens** (identical across COURSES, DOCUMENT HUB and the dashboard home — reuse verbatim so pages don't drift):

- card: `rounded-[17px] border border-[#dfe1e6] bg-white shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)]`, padding `p-4 md:px-[21px] md:pt-[21px] md:pb-4`, `flex flex-col gap-6`
- search input: `h-[38px] rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] placeholder:text-[#a4abb8]`, `w-full sm:w-[470px]`
- table head: `h-10 px-[18px] text-[15.5px] font-medium tracking-[0.31px] text-[#666d80]` + `rounded-l-[9px]` / `rounded-r-[9px]` on the end cells
- table cell / row: `h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]`
- kebab trigger: `size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4`
- pagination: 40px squares, `rounded-[8px]`, prev/next `border-[#d9d9d9]`, numbers `variant=ghost text-[#1c1c1c]`, active `variant=default`; "Showing…" + "Show N entries" at `text-xs tracking-[-0.36px]`
- page header: breadcrumb `text-sm font-medium` two-tone (`#a0aec0` / `#2d3748`) above `h1` `text-[28px] sm:text-[33.5px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30]`, block `mb-[30px] gap-[5px]`
- primary button: `h-12 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]`, icon `size-[25px]`

**Known Figma inconsistencies — do not chase them:** LMS-140 reports the table-header colour as `#2a3144` while LMS-61 and the DOCUMENT HUB frames use `#666d80` (use `#666d80`); button fills vary between `#394ce6` and `#4758e0` while the app token `--primary` is `#4730f7` (use the token); the 4th stat card in LMS-61 has a red border on a yellow fill (copy-paste slip).

See [[reference-figma-lms-v2]] for the same warning applied to DOCUMENT HUB, and [[local-ui-verification]] for driving the running app.
