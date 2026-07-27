---
name: reference-figma-worker-certificates
description: Figma frames for the worker/admin Certificates page and the shared certificate modal live in a SECOND "WORKERS" section (14044:73449), not the WORKER USERTYPE section you'd expect.
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)".

- **Worker certificates page** = `14044:73451` (LMS - 143) — title + "Last 7 days" chip + filled
  Export button, then `Card Log Activity` rows.
- **Certificate modal** = `14048:42478` (LMS - 170); the modal itself is the instance
  `14048:43288` → card `0:11` (1000×710 at 220,157 in a 1440×1024 frame) + `0:142`
  "Circle button" (40×40 at 1370,31). The card **is** the certificate artwork — no header
  bar, no title, no in-modal action buttons.
- Admin-side copies of the same modal: `14003:117427` (LMS - 162), `14284:43681` (LMS - 196),
  and staff profile `14004:118608`. LMS-196 omits the signature block and puts the QR above a
  PRESENTED ON / VALID CERTIFICATE ID row — that's the variant `CertificateDocument.tsx` implements.

**These frames are NOT under `12716:27430` (WORKER USERTYPE).** That section's subsections
("WORKERS" `12539:36800`, "WORKERS - DESKTOP VIEW" `12539:40169`) contain the dashboard,
trainings and course frames but **no** certificates page and **no** certificate modal — and its
LMS-113 "Well done! You've earned a Certificate!" frame is the completion popup, a different thing.

**How to find frames like this fast:** `get_metadata` on the whole page node `12539:30414`
overflows into a file; grep that file for the *text* you expect (Figma text layers are named
after their content, e.g. `name="Export"`, `name="Certificate of Completion"`) while tracking
the enclosing `<section>`/`<frame>` by indentation. Screenshotting candidates one by one is
much slower.

Geometry (this section is **1:1**, like BILLINGS — see [[project-figma-to-css-scale]]):
filter chip 159×41.26 (white, border `#d6d6d6`, r8, px-12, 18px calendar + label + caret,
label 16px medium `#514346`), 10px gap, Export button 121.8×41.26 (`#394ce6`, r≈12, px≈24,
gap 8, 18px download icon, 15.66px semibold). Page title 31.5px, subtitle 18px/28 `#525252`.
Row card: white, border `#dfe1e7`, r10, px-20 py-22, 45×45 award tile, 20px title,
15px `#6f6f6f` sub, pill `#eaf2fd`/`#0e69f3`.

Related: [[reference-figma-lms-v2]], [[reference-figma-staff-section]].
