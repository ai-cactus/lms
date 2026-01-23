---
description: How to work with Figma designs for THERAPTLY LMS
---

# Figma Design Workflow

## Main Design File
**URL:** https://www.figma.com/design/cySAabdYLDKzwbs88owBHn/THERAPTLY?node-id=9882-16014&m=dev
**File Key:** `cySAabdYLDKzwbs88owBHn`

## When Creating New Pages
1. Fetch the design from Figma using `mcp_figma_get_figma_data` with file key `cySAabdYLDKzwbs88owBHn`
2. Identify the correct node ID for the page/component
3. Download required assets using `mcp_figma_download_figma_images`
4. Save assets to `/public/assets/` with appropriate subfolder

## Key Node IDs
| Page | Node ID |
|------|---------|
| Design Flow Root | 9882-16014 |
| Login Page | 10131-19152 |
| Right Sidebar | 10131-19183 |

## Asset Location
All downloaded assets go to `/public/assets/onboarding/` or appropriate subfolder.

## Design Guidelines
- Use exact colors from Figma (e.g., `#2D4DDD` for blue sidebar)
- Match border radius values (e.g., `rounded-[22px]`)
- Use Inter font family
- Ensure responsive layouts with Tailwind CSS
