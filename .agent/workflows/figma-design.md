---
description: How to fetch and reference Figma design specs before implementing UI components
---

# Figma Design Reference Workflow

This workflow explains how to query Figma designs for accurate UI implementation.

## Figma File Info
- **File URL**: https://www.figma.com/design/cySAabdYLDKzwbs88owBHn/THERAPTLY
- **File Key**: `cySAabdYLDKzwbs88owBHn`

## Before Implementing a UI Component

// turbo
1. **Get the node ID** from the Figma URL. The node-id appears after `?node-id=` in the URL (e.g., `9882-16014`).

// turbo
2. **Fetch the node details** using the Figma API:
```bash
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/cySAabdYLDKzwbs88owBHn/nodes?ids=NODE_ID" | jq '.nodes'
```
Replace `NODE_ID` with the actual node ID (use `-` instead of `:` in the ID).

## Downloading Images and Assets

// turbo
3. **Export a node as PNG/SVG** (for screenshots, icons, illustrations):
```bash
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/cySAabdYLDKzwbs88owBHn?ids=NODE_ID&format=png&scale=2"
```
Formats: `png`, `jpg`, `svg`, `pdf`. Scale: 1-4 (2 recommended for retina).

// turbo
4. **Download the exported image**:
```bash
curl -o /home/homepc/lms2/public/images/FILENAME.png "IMAGE_URL_FROM_STEP_3"
```

// turbo
5. **Export multiple nodes at once** (batch export):
```bash
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/cySAabdYLDKzwbs88owBHn?ids=NODE_ID1,NODE_ID2,NODE_ID3&format=svg"
```

// turbo
6. **Get image fills** (background images used in a design):
```bash
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/cySAabdYLDKzwbs88owBHn/images"
```
This returns all images uploaded to the file with their URLs.

## Downloading Component Assets

// turbo
7. **Get all components in file** (icons, buttons, cards, etc.):
```bash
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/cySAabdYLDKzwbs88owBHn/components" | jq '.meta.components[] | {name, node_id: .node_id}'
```

// turbo
8. **Export all icons as SVG** (find icon nodes first, then batch export):
```bash
# Get component list, filter for icons, then export
source /home/homepc/lms2/.env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/cySAabdYLDKzwbs88owBHn?ids=ICON_NODE_IDS&format=svg"
```

## Key Design Properties to Extract

When reviewing Figma node data, pay attention to:
- **absoluteBoundingBox**: Width, height, x, y positions
- **fills**: Background colors (look for `color` with r,g,b,a values)
- **strokes**: Border colors and widths
- **effects**: Shadows, blurs
- **style**: Typography (fontSize, fontFamily, fontWeight, lineHeight, letterSpacing)
- **cornerRadius**: Border radius values
- **paddingLeft/Right/Top/Bottom**: Internal spacing
- **itemSpacing**: Gap between flex items

## Color Conversion

Figma colors are 0-1 range. Convert to CSS:
- `rgb(r*255, g*255, b*255)` or 
- `rgba(r*255, g*255, b*255, a)`

## Standard Asset Locations

Save downloaded assets to:
- **Images**: `/home/homepc/lms2/public/images/`
- **Icons (SVG)**: `/home/homepc/lms2/public/icons/`
- **Backgrounds**: `/home/homepc/lms2/public/images/backgrounds/`
