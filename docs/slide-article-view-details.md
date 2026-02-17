# Slide View & Article View Technical Documentation

This document explicitly details the technical implementation, UX/UI specifications, and structural hierarchy of the **Slide View** and **Article View** components within the Course Wizard (Step 5).

## 1. Component Architecture

**Parent Component:** `Step5Review.tsx`
**Styling Module:** `CourseWizard.module.css`

The `Step5Review` component manages the state for toggling between two view modes:
- `'article'`: The default editor view using React Quill.
- `'slides'`: A preview mode simulating a slide deck presentation.

### State Management
```typescript
const [viewMode, setViewMode] = useState<'article' | 'slides'>('article');
const [activeModuleIndex, setActiveModuleIndex] = useState(0); // Navigation state
```

---

## 2. Layout Structure (Common)

Both views are hosted within a **Split Screen Layout** (`.splitLayout`):
- **Left Sidebar (`.sidebar`):**
    - Navigation list of course modules.
    - Width: Fixed (implicitly via `.moduleList` constraints).
- **Right Panel (`.editorPanel`):**
    - Dynamic content area that switches based on `viewMode`.
    - Flex item (`flex: 1`) to fill remaining space.

---

## 3. Slide View (`.slides`)

### UI Specifications (Visual Design)
The slide view is designed to look like a premium, modern presentation slide.

- **Effect:** **Glassmorphism** & **Card UI**
- **Aspect Ratio:** `16/9` (Fixed via CSS)
- **Background:** Linear Gradient (`135deg`, `#ffffff` to `#f9fafb`)
- **Shadows:** Deep, layered shadows for elevation:
    - Shadow 1: `0 20px 25px -5px rgba(0, 0, 0, 0.1)`
    - Shadow 2: `0 10px 10px -5px rgba(0, 0, 0, 0.04)`
- **Border:** Thin semi-transparent border (`rgba(255, 255, 255, 0.8)`)

### Typography & Spacing (Recent Updates)
- **Card Padding:** `24px` (Compact)
- **Title Font:** `16px`, Weight `800`, Color `#1E293B`
- **Title Alignment:** **Left**
- **Body Font:** `11px`, Line-height `1.5`, Color `#475569`
- **Body Alignment:** **Justified** (`text-align: justify`)
- **Bullet Points:** Custom styled with `::before` pseudo-element (Color `#4F46E5`, Size ~`20px`, Positioned absolute).

### Technical Structure (DOM)
```html
<div class="previewContainer">
  <div class="slideCardWrapper">
    <!-- AnimatePresence Boundary -->
    <motion.div class="slideCard">
      <!-- Header -->
      <div class="slideHeader">
        <span class="moduleBadge">Module {N}</span>
        <span class="durationBadge">{Time}</span>
      </div>
      
      <!-- Title -->
      <h3 class="slideTitle">{Module Title}</h3>
      
      <!-- Content Body -->
      <div class="slideBody" dangerouslySetInnerHTML={{ __html: content }} />
    </motion.div>
  </div>
</div>
```

### UX / Interactions
- **Transitions:** Uses `framer-motion` for smooth slide transitions.
    - **Enter:** Opacity fade-in + Slide from right (`x: 20` to `0`).
    - **Exit:** Opacity fade-out + Slide to left (`x: 0` to `-20`).
    - **Mode:** `wait` (Ensures old slide leaves before new one enters).
- **Overflow Handling:** `.slideBody` has `overflow-y: auto` with a custom thin scrollbar to handle content that exceeds the 16/9 ratio.

---

## 4. Article View (`.article`)

### UI Specifications
The article view functions as a document editor.

- **Container:** `.articlePaper`
- **Styling:** White paper sheet look with soft shadow (`box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08)`).
- **Border:** `1px solid #E2E8F0`.
- **Border Radius:** `12px`.

### Technical Structure (DOM)
```html
<div class="articlePaper">
  <!-- Title Editor -->
  <input class="paperTitleInput" value={title} />
  
  <!-- Content Editor -->
  <div class="quillWrapper">
    <ReactQuill theme="snow" value={content} />
  </div>

  <!-- Sticky Footer Navigation -->
  <div class="stickyBottomBar">
    <button>Previous</button>
    <span>Module X of Y</span>
    <button>Next</button>
  </div>
</div>
```

### UX / Interactions
- **Real-time Editing:** The `input` and `ReactQuill` components trigger `handleTitleChange` and `handleContentChange` respectively.
- **Auto-save:** Changes update the parent state (`generatedContent`) immediately, preventing data loss.
- **Sticky Navigation:** A bottom bar (`.stickyBottomBar`) remains visible to allow linear progression through modules without leaving the editor context.

---

## 5. CSS Classes Reference

| Element | Class Name | Key Properties |
| :--- | :--- | :--- |
| **Slide Container** | `.slideCard` | `aspect-ratio: 16/9`, `padding: 24px`, `background: linear-gradient(...)` |
| **Slide Body** | `.slideBody` | `font-size: 11px`, `text-align: justify`, `overflow-y: auto` |
| **Slide Title** | `.slideTitle` | `font-size: 16px`, `text-align: left`, `font-weight: 800` |
| **Article Container** | `.articlePaper` | `max-width: 800px`, `background: white`, `height: 100%` |
| **Editor Input** | `.paperTitleInput` | `font-size: 24px`, `font-weight: 700`, `border: none` (visually) |

---

## 6. Libraries Used
- **Framer Motion:** For slide transition animations.
- **React Quill (New):** Rich text editor for the article view (`react-quill-new`).
- **DOMPurify (Implicit):** Should be used when rendering HTML content in slides (currently using `dangerouslySetInnerHTML`).


---

## 7. Learner View Implementation (`/learn/[id]`)

The design principles from the Course Wizard have been extended to the actual learner interface to ensure a consistent user experience.

### Architecture
- **Page Component:** `src/app/learn/[id]/page.tsx`
- **Styling Module:** `src/app/learn/[id]/LearnerRedesign.module.css`
- **Layout:** Reuses the **Rail + Topbar** structure.

### Key Differences from Wizard
1.  **Read-Only:** The content is not editable.
2.  **Progress Tracking:** The Rail dots indicate lesson completion status:
    - **Muted Ring:** Pending
    - **Dark Solid:** Active
    - **Grey Background:** Completed
3.  **Quiz Integration:**
    - The Rail includes a special "Q" node for the quiz.
    - **Quiz Views:**
        - **Intro:** Card showing pass mark, time limit, and attempts.
        - **Active:** Timer, question card with selection logic.
        - **Results:** Success/Failure state with score and "Retake" or "Attest" options.

### View Modes
- **Slide Mode:** Default mode. Shows content in the 16:9 card with navigation arrows.
- **Article Mode:** toggleable via Topbar. Shows content in a continuous vertical paper view.

