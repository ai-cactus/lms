---
name: reference-figma-settings-section
description: Figma SETTINGS section (LMS v2) frame→tab map, the exact 1.125x scale factor, which card kit it uses, and the designed-but-omitted elements
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)", section SETTINGS = `14519:90255`. Three frames, one per Settings tab:

- `14519:89615` Settings — Users & Permissions (content node `14519:89629`)
- `14519:89683` Settings — Roles (content node `14519:89697`)
- `14519:89981` Settings — Facility (content node `14519:89995`)

**Scale: exactly 1.125x, and it applies to type AND padding, not just vertical.**
Every atomic value in these frames is `1.125 x` a clean integer (31.5→28, 20.25→18, 15.75→14, 14.625→13, 13.5→12, 12.375→11, 27→24, 18→16, 40.5→36, 54→48, 63→56). Container widths (1088 content, 440 search) were re-fit by auto-layout and are **not** scaled — use them as-is. Cross-check: the 13495/14004-generation staff frames are 1.0x (33.488px title used literally), so the scale factor is per-frame-generation — always divide a value and see whether you land on an integer before assuming.

**Card kit:** these frames use kit 1 (the non-uppercase grey-head kit), but with its own hexes — card `rounded-[16px] border-[#eceef2]`, table head `bg-[#f9fafb]` with 14px medium `#667085` heads, **no row dividers and no row hover**. Not the newer uppercase 12px/`#e2e8f0` kit.

**Designed but deliberately not built** (see [[figma_settings_deviations]] for the reasoning): the per-row empty 32px action button in the users table, the "Super Admin is a Theraptly-internal role…" footnote under the roles matrix, and the full 4-sided `#f0f2f5` box stroke on the tab strip.
