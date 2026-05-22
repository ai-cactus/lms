---
description: 
---

# Figma-to-Code Agent Guide

> **Portability**: This guide is project-agnostic. Copy it into any repository and follow the
> setup steps below. All paths are templated — the agent resolves them at runtime.

---

## Table of Contents

1. [Prerequisites — Figma API Token](#1-prerequisites--figma-api-token)
2. [How to Use This Guide in a New Project](#2-how-to-use-this-guide-in-a-new-project)
3. [Agent: Discover Project Context](#3-agent-discover-project-context)
4. [Agent: Detect Existing Styling System](#4-agent-detect-existing-styling-system)
5. [Extracting the Figma File Key & Node IDs](#5-extracting-the-figma-file-key--node-ids)
6. [Fetching Design Specs via the Figma API](#6-fetching-design-specs-via-the-figma-api)
7. [Downloading Assets](#7-downloading-assets)
8. [Translating Figma Values to CSS / Code](#8-translating-figma-values-to-css--code)
9. [Full Agent Workflow Checklist](#9-full-agent-workflow-checklist)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites — Figma API Token

The Figma REST API requires a **Personal Access Token (PAT)**. You generate this once and store
it as an environment variable in your project.

### Step 1 — Generate a Figma PAT

1. Log into [figma.com](https://www.figma.com).
2. Click your **avatar** (top-left) → **Settings**.
3. Scroll to the **Personal access tokens** section.
4. Click **Generate new token**, give it a descriptive name (e.g. `my-project-agent`), and set an
   expiration that suits your project timeline.
5. **Copy the token immediately** — Figma only shows it once.

### Step 2 — Store the Token Securely

Add `FIGMA_ACCESS_TOKEN` to your project's `.env` (or `.env.local`) file:

```bash
# .env  — never commit this file to version control
FIGMA_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> [!CAUTION]
> Ensure `.env` (and `.env.local`) are listed in `.gitignore`. **Never hardcode the token**
> in source files, scripts, or agent prompts.

Verify it is gitignored:

```bash
grep -E "^\.env" .gitignore || echo "WARNING: .env is not gitignored!"
```

### Step 3 — Verify the Token Works

```bash
# Load the token from .env and ping the Figma API
source .env && curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/me" | jq '.email'
```

A successful response returns your Figma account email. An error returns `{"status": 403, ...}`.

---

## 2. How to Use This Guide in a New Project

### Option A — Copy into the Project (Recommended)

Place this file at a path your agent knows to look for:

```
YOUR_PROJECT/
  .agent/
    workflows/
      figma-design.md    ← this file
```

No further edits needed — all paths and values are resolved at runtime by the agent.

### Option B — Reference as a Standalone Document

Paste the entire file content into the system prompt or context window of your agent before
saying "implement this Figma design: [URL]". The agent will follow the checklist in section 9.

---

## 3. Agent: Discover Project Context

> **Instructions for the agent**: Before performing any Figma work, resolve the project's
> working directory and asset storage paths. Do not hardcode paths.

### Resolve the working directory

```bash
# The agent should run this to get the absolute project root
pwd
```

Store the result as `$PROJECT_ROOT`. All subsequent paths are relative to this.

### Determine where assets should be saved

The agent should check for common asset directories:

```bash
# Check for common static/public directories in order of preference
ls -d "$PROJECT_ROOT"/public \
       "$PROJECT_ROOT"/static \
       "$PROJECT_ROOT"/assets \
       "$PROJECT_ROOT"/src/assets 2>/dev/null | head -1
```

If unsure, **ask the user**:
> "Where should I save downloaded Figma assets? (e.g. `public/images`, `src/assets`)"

Set these variables before proceeding:

```bash
PROJECT_ROOT=$(pwd)                          # e.g. /home/user/dev/my-app
ASSETS_DIR="$PROJECT_ROOT/public"           # adjust per project
IMAGES_DIR="$ASSETS_DIR/images"
ICONS_DIR="$ASSETS_DIR/icons"
BACKGROUNDS_DIR="$ASSETS_DIR/images/backgrounds"

mkdir -p "$IMAGES_DIR" "$ICONS_DIR" "$BACKGROUNDS_DIR"
```

### Load the Figma token

```bash
# Precedence: .env.local > .env > environment
ENV_FILE="$PROJECT_ROOT/.env.local"
[ ! -f "$ENV_FILE" ] && ENV_FILE="$PROJECT_ROOT/.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

# Validate
if [ -z "$FIGMA_ACCESS_TOKEN" ]; then
  echo "ERROR: FIGMA_ACCESS_TOKEN is not set. See section 1 of figma-design.md."
  exit 1
fi
```

---

## 4. Agent: Detect Existing Styling System

> **Instructions for the agent**: Before writing a single line of CSS or JSX, audit the project
> to understand what styling system is already in use. **Never introduce a new styling approach
> that conflicts with what already exists.** If ambiguous, ask the user.

### Step 1 — Run the detection script

```bash
# Run all checks from $PROJECT_ROOT
cd "$PROJECT_ROOT"

echo "=== Styling System Detection ==="

# Tailwind CSS
if [ -f tailwind.config.js ] || [ -f tailwind.config.ts ] || [ -f tailwind.config.mjs ]; then
  echo "[TAILWIND] tailwind.config found"
  # Detect Tailwind version
  cat node_modules/tailwindcss/package.json 2>/dev/null | jq -r '.version' | \
    xargs -I{} echo "  Version: {}"
fi

# Vanilla CSS / CSS custom properties
if find src -name "*.css" -not -name "*.module.css" | grep -q .; then
  echo "[VANILLA CSS] Global .css files found:"
  find src -name "globals.css" -o -name "index.css" -o -name "app.css" 2>/dev/null
fi

# CSS Modules
if find src -name "*.module.css" | grep -q .; then
  echo "[CSS MODULES] .module.css files detected"
fi

# Sass / SCSS
if find src -name "*.scss" -o -name "*.sass" | grep -q .; then
  echo "[SASS/SCSS] Sass files detected"
fi

# styled-components / emotion
if grep -E "styled-components|@emotion" package.json 2>/dev/null | grep -q .; then
  echo "[CSS-IN-JS] styled-components or Emotion detected"
fi

# shadcn/ui (Tailwind + Radix preset)
if [ -f components.json ]; then
  echo "[SHADCN/UI] components.json found — shadcn/ui project"
  cat components.json | jq '{style, tailwind, aliases}'
fi

# MUI / Chakra / Mantine (common component libraries)
grep -E '"@mui|@chakra-ui|@mantine"' package.json 2>/dev/null | \
  sed 's/.*"\(@[^"]*\)".*/[COMPONENT LIB] \1/' || true

echo "=== End Detection ==="
```

### Step 2 — Read existing design tokens

Depending on what was detected, the agent must read the existing tokens **before** applying any
Figma values:

#### Tailwind projects

```bash
# Read existing color palette, spacing, font, and breakpoint config
cat tailwind.config.js 2>/dev/null || cat tailwind.config.ts
```

The agent should **map Figma values to the nearest existing Tailwind token** rather than using
arbitrary values. For example, if Figma specifies `#1E40AF` and `blue-800` is already in the
config, use `text-blue-800` — not `text-[#1E40AF]`.

#### Vanilla CSS / CSS custom properties

```bash
# Find where CSS variables (design tokens) are defined
grep -r "--" src/ --include="*.css" -l
# Then read the primary one:
cat src/app/globals.css 2>/dev/null || cat src/styles/variables.css 2>/dev/null
```

The agent should reuse existing `--color-*`, `--spacing-*`, `--font-*` variables.
Only define new variables if the Figma spec introduces something genuinely new.

#### CSS Modules

```bash
# Find all module files to understand naming conventions
find src -name "*.module.css" | head -10
# Read a sample to understand existing class naming patterns
cat $(find src -name "*.module.css" | head -1)
```

#### CSS-in-JS (styled-components / Emotion)

```bash
# Find the theme file
find src -name "theme.ts" -o -name "theme.js" 2>/dev/null | head -5
# Read it
cat $(find src -name "theme.ts" -o -name "theme.js" 2>/dev/null | head -1)
```

Map Figma values to the theme object keys. Never use hardcoded hex strings in `styled` calls
if the theme already defines those colors.

#### shadcn/ui projects

```bash
# shadcn uses CSS variables defined in globals.css with oklch/hsl format
grep -A 3 ":root" src/app/globals.css 2>/dev/null | head -40
```

Map Figma colors to the nearest shadcn semantic token (`--primary`, `--secondary`,
`--muted`, `--accent`, `--destructive`, etc.) where possible.

### Step 3 — Confirm approach with the user (if ambiguous)

If the detection finds **multiple systems** (e.g. both Tailwind and CSS Modules), ask:

> "I found both Tailwind CSS and CSS Modules in this project. Which should I use for this
> component? Or is there a pattern — e.g. Tailwind for layout, CSS Modules for
> component-specific styles?"

If the detection finds **no styling system**, ask:

> "I couldn't detect an existing styling system. Should I use Tailwind CSS, vanilla CSS
> custom properties, or CSS Modules? Please specify the version if Tailwind."

### Step 4 — Styling rules the agent must follow

| Rule | Why |
|---|---|
| Match existing patterns exactly | Consistency over personal preference |
| Reuse existing tokens/variables/classes | Avoid duplication and drift |
| Do not install new CSS libraries | Breaking change risk |
| Use the same unit system (px vs rem) | Avoid mixed units causing layout bugs |
| Follow existing responsive breakpoints | Do not invent new breakpoints |
| Keep class naming consistent | Matches the existing component pattern |

---

## 5. Extracting the Figma File Key & Node IDs

### The Figma File Key

Every Figma design URL follows this pattern:

```
https://www.figma.com/design/{FILE_KEY}/{file-name}?node-id={NODE_ID}
```

Example:
```
https://www.figma.com/design/cySAabdYLDKzwbs88owBHn/MyApp?node-id=9882-16014
```

- **`FILE_KEY`** = `cySAabdYLDKzwbs88owBHn`
- **`NODE_ID`** = `9882-16014`

> [!IMPORTANT]
> When passing a `node-id` to the API, replace `:` with `-` (some older Figma URLs use
> `9882:16014` format — both mean the same node).

Store your file key:

```bash
FIGMA_FILE_KEY="YOUR_FILE_KEY_HERE"   # replace with actual key from the URL
```

### Finding Node IDs

1. Open the Figma file in your browser.
2. Click on a frame, component, or element you want to implement.
3. The URL updates to include `?node-id=XXXX-YYYY` — that is the node ID.
4. Right-clicking a layer in the left panel → **Copy link** also gives you the node URL.

---

## 6. Fetching Design Specs via the Figma API

All API calls follow this pattern:

```bash
# Template for all Figma API calls in this guide
FIGMA_API="https://api.figma.com/v1"
AUTH_HEADER="X-Figma-Token: $FIGMA_ACCESS_TOKEN"
```

### 6.1 — Fetch a specific node's design data

```bash
NODE_ID="9882-16014"   # replace with target node ID

curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY/nodes?ids=$NODE_ID" | jq '.nodes'
```

### 6.2 — Fetch the entire file structure (frame/page overview)

```bash
curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY" | jq '.document.children[] | {name, id, type}'
```

### 6.3 — List all pages in the file

```bash
curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY" | jq '[.document.children[] | {name, id}]'
```

### 6.4 — Get all named components (buttons, cards, icons, etc.)

```bash
curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY/components" \
  | jq '.meta.components[] | {name, node_id, description}'
```

### 6.5 — Get all local styles (color tokens, text styles)

```bash
curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY/styles" \
  | jq '.meta.styles[] | {name, node_id, style_type}'
```

---

## 7. Downloading Assets

### 7.1 — Export a single node as PNG

```bash
NODE_ID="9882-16014"
FILENAME="hero-banner"

# Step A: get the S3/CDN URL from Figma
IMAGE_URL=$(curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/images/$FIGMA_FILE_KEY?ids=$NODE_ID&format=png&scale=2" \
  | jq -r ".images[\"$NODE_ID\"]")

# Step B: download it
curl -f -s -o "$IMAGES_DIR/$FILENAME.png" "$IMAGE_URL"
echo "Saved: $IMAGES_DIR/$FILENAME.png"
```

Format options: `png`, `jpg`, `svg`, `pdf`.  
Scale options: `1` (1x), `2` (retina/2x recommended), `3`, `4`.

### 7.2 — Export a single node as SVG

```bash
NODE_ID="1234-5678"
FILENAME="logo"

IMAGE_URL=$(curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/images/$FIGMA_FILE_KEY?ids=$NODE_ID&format=svg" \
  | jq -r ".images[\"$NODE_ID\"]")

curl -f -s -o "$ICONS_DIR/$FILENAME.svg" "$IMAGE_URL"
```

### 7.3 — Batch export multiple nodes

```bash
# Comma-separate multiple node IDs
NODES="1234-5678,9012-3456,7890-1234"

RESPONSE=$(curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/images/$FIGMA_FILE_KEY?ids=$NODES&format=png&scale=2")

# Download each image (requires jq + bash loop)
echo "$RESPONSE" | jq -r '.images | to_entries[] | "\(.key) \(.value)"' | \
while read -r node_id url; do
  safe_name=$(echo "$node_id" | tr ':' '-')
  curl -f -s -o "$IMAGES_DIR/${safe_name}.png" "$url"
  echo "Saved: $IMAGES_DIR/${safe_name}.png"
done
```

### 7.4 — Get all image fills (background images embedded in the design)

```bash
curl -s -H "$AUTH_HEADER" \
  "$FIGMA_API/files/$FIGMA_FILE_KEY/images" \
  | jq '.meta.images'
```

---

## 8. Translating Figma Values to CSS / Code

### 8.1 — Colors

Figma stores colors in `0–1` float range (RGBA). Convert to CSS:

| Figma value | CSS equivalent |
|---|---|
| `r: 0.2, g: 0.4, b: 0.8, a: 1` | `rgb(51, 102, 204)` |
| `r: 0.2, g: 0.4, b: 0.8, a: 0.5` | `rgba(51, 102, 204, 0.5)` |

Formula: `Math.round(channel * 255)`

```js
// JavaScript helper
const figmaToRgb = ({ r, g, b, a }) =>
  a === 1
    ? `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`
    : `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a.toFixed(2)})`;
```

### 8.2 — Typography

| Figma property | CSS property |
|---|---|
| `fontSize` | `font-size: {value}px` |
| `fontFamily` | `font-family: '{value}'` |
| `fontWeight` | `font-weight: {value}` |
| `lineHeightPx` | `line-height: {value}px` |
| `letterSpacing` | `letter-spacing: {value}px` |
| `textAlignHorizontal` | `text-align: left / center / right` |
| `textDecoration` | `text-decoration: underline / none` |
| `textCase` | `text-transform: uppercase / lowercase` |

### 8.3 — Spacing & Layout

| Figma property | CSS property |
|---|---|
| `paddingLeft/Right/Top/Bottom` | `padding: top right bottom left` |
| `itemSpacing` | `gap: {value}px` (flex/grid) |
| `absoluteBoundingBox.width` | `width: {value}px` |
| `absoluteBoundingBox.height` | `height: {value}px` |
| `cornerRadius` | `border-radius: {value}px` |
| `topLeftRadius / topRightRadius` | Per-corner `border-radius` |

### 8.4 — Effects (Shadows & Blurs)

**Drop shadow**:
```json
{ "type": "DROP_SHADOW", "color": {...}, "offset": {"x": 0, "y": 4}, "radius": 8, "spread": 0 }
```
→ CSS: `box-shadow: 0px 4px 8px 0px rgba(r, g, b, a);`

**Inner shadow**:
→ CSS: `box-shadow: inset 0px 4px 8px 0px rgba(r, g, b, a);`

**Layer blur**:
```json
{ "type": "LAYER_BLUR", "radius": 12 }
```
→ CSS: `filter: blur(12px);`

**Background blur**:
→ CSS: `backdrop-filter: blur(12px);`

### 8.5 — Borders / Strokes

```json
{ "strokes": [{ "color": {...} }], "strokeWeight": 1, "strokeAlign": "INSIDE" }
```
→ CSS: `border: 1px solid rgba(r, g, b, a);`  
- `INSIDE` → `box-sizing: border-box`
- `OUTSIDE` → use `outline` instead of `border`

### 8.6 — Gradients

```json
{ "type": "GRADIENT_LINEAR", "gradientStops": [
  { "color": {...}, "position": 0 },
  { "color": {...}, "position": 1 }
]}
```
→ CSS: `background: linear-gradient(angle, color1 0%, color2 100%);`

---

## 9. Full Agent Workflow Checklist

Use this as your step-by-step execution order when implementing any UI from a Figma link.

```
[ ] 1. SETUP
      [ ] Run `pwd` to find $PROJECT_ROOT
      [ ] Source .env / .env.local and verify $FIGMA_ACCESS_TOKEN
      [ ] Set $FIGMA_FILE_KEY from the provided Figma URL
      [ ] Create asset directories (images/, icons/, backgrounds/)

[ ] 2. DETECT EXISTING STYLING SYSTEM  (see section 4)
      [ ] Run styling detection script
      [ ] Read existing design tokens (tailwind.config / globals.css / theme file)
      [ ] Note existing breakpoints, spacing scale, and color palette
      [ ] If ambiguous, ask the user before proceeding

[ ] 3. UNDERSTAND THE DESIGN STRUCTURE
      [ ] Fetch all pages: GET /files/{key}
      [ ] List components: GET /files/{key}/components
      [ ] List styles (color/text tokens): GET /files/{key}/styles

[ ] 4. EXTRACT TARGET NODE(S)
      [ ] Get the node-id from the Figma URL or user instruction
      [ ] Fetch node data: GET /files/{key}/nodes?ids={node-id}
      [ ] Parse: colors, typography, spacing, effects, layout mode

[ ] 5. MAP FIGMA VALUES → EXISTING TOKENS
      [ ] Match Figma colors to existing CSS vars / Tailwind palette / theme keys
      [ ] Match Figma font sizes to existing type scale
      [ ] Match Figma spacing to existing spacing scale
      [ ] Flag any genuinely new values that need to be added to the token system

[ ] 6. PLAN THE COMPONENT STRUCTURE
      [ ] Map Figma frames/groups → component hierarchy
      [ ] Identify reusable sub-components
      [ ] Note responsive breakpoints (Figma constraints: SCALE, FIXED, STRETCH)

[ ] 7. DOWNLOAD REQUIRED ASSETS
      [ ] Export images as PNG @2x
      [ ] Export icons as SVG
      [ ] Save to $IMAGES_DIR / $ICONS_DIR

[ ] 8. IMPLEMENT THE UI
      [ ] Use only the detected styling system — no mixed approaches
      [ ] Apply existing tokens (not raw Figma values) wherever possible
      [ ] Build components matching Figma layout exactly
      [ ] Use Figma `absoluteBoundingBox` values for sizing reference
      [ ] Use existing breakpoints for responsive behaviour

[ ] 9. VERIFY FIDELITY
      [ ] Side-by-side visual comparison (screenshot vs Figma)
      [ ] Check responsiveness against Figma constraints
      [ ] Verify hover/active states if Figma has prototype interactions

[ ] 10. DOCUMENT
       [ ] Note any deviations from the Figma spec and why
       [ ] Note any new tokens added to the design system
```

---

## 10. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `403 Forbidden` from API | Invalid or expired token | Re-generate token in Figma settings |
| `404 Not Found` on file | Wrong file key | Re-copy key from Figma URL |
| Node returns `null` | Node ID uses `:` instead of `-` | Replace `:` with `-` in the node ID |
| Image URL returns `null` | Node is not exportable (e.g. pure vector group) | Wrap it in a frame in Figma, or export parent frame |
| Colors look wrong | Missed the `*255` conversion | Figma uses 0–1 floats; multiply by 255 |
| Asset not found after download | `curl` silently failed | `-f` flag is included; check the URL is not `null` |
| `.env` token not loading | Wrong file path or missing `export` | Use `source .env` not `. .env`; add `export` prefix |
| Styling system not detected | Non-standard config file name | Ask the user to point to the root config file |
| Mixed styles after implementation | Agent added Tailwind to a CSS Modules project | Revert and re-implement using detected system only |

---

## Quick Reference — Common API Endpoints

| Purpose | Endpoint |
|---|---|
| Auth check | `GET /v1/me` |
| File structure | `GET /v1/files/{key}` |
| Specific nodes | `GET /v1/files/{key}/nodes?ids={id1,id2}` |
| All components | `GET /v1/files/{key}/components` |
| All styles | `GET /v1/files/{key}/styles` |
| Export images | `GET /v1/images/{key}?ids={id}&format=png&scale=2` |
| Image fills | `GET /v1/files/{key}/images` |

Base URL: `https://api.figma.com`  
Auth header: `X-Figma-Token: $FIGMA_ACCESS_TOKEN`

---

## How to Add This to a New Project

1. **Copy this file** to `.agent/workflows/figma-design.md` inside your project root.
2. **Update `.gitignore`** — ensure `.env` and `.env.local` are ignored.
3. **Add your token** to `.env`: `FIGMA_ACCESS_TOKEN=figd_...`
4. **Share the Figma link** with your agent and reference this workflow file.
5. For **Antigravity / Gemini agents**: the workflow is auto-discovered via `.agent/workflows/`.
   Invoke it with `/figma-design` or reference the file path in your prompt.
6. For **other LLMs (Claude.ai, GPT, Cursor, etc.)**: paste this entire file into the context
   window before your design implementation request.

> [!TIP]
> You can pin this file in your repo's README under a "Working with Designs" section so every
> contributor (human or agent) knows how to interact with Figma.

---

*Guide version: 2.0 — includes styling system detection.*
