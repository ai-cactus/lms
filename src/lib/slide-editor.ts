/**
 * slide-editor.ts
 *
 * The editing model behind the in-place slide editor. It turns one editable
 * section (see `splitIntoEditableSections` in `slide-splitter.ts`) into a list
 * of text regions an admin may type into, renders that section with each region
 * wrapped in a `contenteditable` span, and splices edited text back into the
 * section's own source bytes.
 *
 * The whole design exists to hold one invariant: markup the admin did not type
 * into comes back byte-identical. It is held structurally rather than by care —
 *
 *   - regions are recorded as OFFSETS into the section source, never as copied
 *     strings, so everything outside a region is passed through verbatim;
 *   - offsets are always taken against the ORIGINAL section html, never against
 *     an already-edited copy, so repeated edits cannot drift;
 *   - `applyTextRunEdits` rewrites only the regions present in `edits`, so an
 *     untouched region keeps its original bytes — entities (`&nbsp;`) included.
 *
 * Consequently `applyTextRunEdits(html, scanEditableTextRuns(html), {}) === html`
 * for every input, and a one-region edit changes exactly that region.
 *
 * Wrappers, classes and the locked pedagogical taxonomy below are never part of
 * an editable region, so they cannot be reached from the editing surface at all.
 */

/**
 * Classes whose text is fixed taxonomy, not authored prose: the TELL/SHOW/DO
 * slide-type badge and the CORRECT/INCORRECT/SITUATION scenario tags. Locked by
 * semantic role rather than by position, which is what keeps `.slide-scenario`
 * — the most interleaved block v4.6 emits — safe without a special case.
 */
const LOCKED_CLASS_EXACT = new Set(['scenario-tag']);
const LOCKED_CLASS_PREFIXES = ['slide-type-badge'];

/** Elements whose text content is never authored prose. */
const OPAQUE_TAGS = new Set(['script', 'style', 'title', 'textarea']);

/** Elements that never open a scope, so they must not be pushed on the stack. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Accessible names for the regions v4.6 emits, innermost class first. A region
 * with no recognised ancestor falls back to `DEFAULT_REGION_LABEL`.
 */
const REGION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['slide-heading', 'Slide heading'],
  ['slide-box-title', 'Box title'],
  ['slide-core-concept', 'Core concept'],
  ['slide-key-points', 'Key point'],
  ['slide-term-item', 'Key term'],
  ['slide-terms-box', 'Key terms'],
  ['slide-details-box', 'Critical detail'],
  ['slide-action-steps', 'Action step'],
  ['slide-checklist', 'Checklist item'],
  ['scenario-label', 'Scenario label'],
  ['scenario-situation', 'Scenario situation'],
  ['scenario-correct', 'Correct action'],
  ['scenario-wrong', 'Common mistake'],
  ['scenario-rationale', 'Scenario rationale'],
  ['step-number', 'Step number'],
  ['step-action', 'Step action'],
  ['step-why', 'Step rationale'],
];

/**
 * Fallback names by element, for content with none of the v4.6 classes —
 * legacy lessons and the article HTML the slide view falls back to.
 */
const TAG_LABELS: Readonly<Record<string, string>> = {
  h1: 'Slide heading',
  h2: 'Slide heading',
  h3: 'Slide heading',
  h4: 'Slide heading',
  h5: 'Slide heading',
  h6: 'Slide heading',
  li: 'List item',
  p: 'Paragraph',
};

const DEFAULT_REGION_LABEL = 'Slide text';

/** Marks a span this module generated. Also the styling hook for the region. */
export const EDITABLE_RUN_CLASS = 'slide-editable-text';

/** Attribute carrying a region's index within its section's run list. */
export const EDITABLE_RUN_ATTRIBUTE = 'data-slide-run';

const EDITABLE_RUN_STYLES = [
  EDITABLE_RUN_CLASS,
  'cursor-text rounded-[3px] outline-none transition-colors',
  'hover:bg-primary/5 focus:bg-primary/5 focus:ring-2 focus:ring-primary/40',
  // An admin may legitimately clear a region. Without a floor it would collapse
  // to zero width and become impossible to click back into.
  'empty:inline-block empty:min-h-[1em] empty:min-w-10 empty:rounded empty:bg-primary/10',
].join(' ');

/** One region of a section an admin may type into. */
export interface SlideTextRun {
  /** Offset of the region's first non-whitespace character in the section source. */
  start: number;
  /** Offset one past the region's last non-whitespace character. */
  end: number;
  /** Accessible name, derived from the region's nearest recognised ancestor. */
  label: string;
}

/** Plain text keyed by a region's index in its section's run list. */
export type SlideRunEdits = Record<number, string>;

interface OpenElement {
  tag: string;
  classes: string[];
  locked: boolean;
}

function isLockedClass(className: string): boolean {
  return (
    LOCKED_CLASS_EXACT.has(className) ||
    LOCKED_CLASS_PREFIXES.some((prefix) => className.startsWith(prefix))
  );
}

/**
 * Locate a tag's closing `>`, skipping any that sits inside a quoted attribute
 * value. Returns -1 for an unterminated tag.
 */
function findTagEnd(html: string, tagStart: number): number {
  let quote: string | null = null;

  for (let i = tagStart + 1; i < html.length; i++) {
    const char = html[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return i;
  }

  return -1;
}

function readClasses(tagSource: string): string[] {
  const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagSource);
  if (!match) return [];
  return (match[1] ?? match[2] ?? match[3] ?? '').split(/\s+/).filter(Boolean);
}

function labelForStack(stack: OpenElement[]): string {
  for (let i = stack.length - 1; i >= 0; i--) {
    for (const [className, label] of REGION_LABELS) {
      if (stack[i].classes.includes(className)) return label;
    }
  }

  const innermost = stack[stack.length - 1];
  return (innermost && TAG_LABELS[innermost.tag]) || DEFAULT_REGION_LABEL;
}

/** Disambiguate repeated region names ("Key point" → "Key point 2"). */
function numberDuplicateLabels(runs: SlideTextRun[]): SlideTextRun[] {
  const totals = new Map<string, number>();
  for (const run of runs) {
    totals.set(run.label, (totals.get(run.label) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return runs.map((run) => {
    if ((totals.get(run.label) ?? 0) < 2) return run;
    const ordinal = (seen.get(run.label) ?? 0) + 1;
    seen.set(run.label, ordinal);
    return { ...run, label: `${run.label} ${ordinal}` };
  });
}

/**
 * List every text region of a section an admin may edit, in document order.
 *
 * Regions are whitespace-trimmed, so the bytes separating two regions — and
 * every tag, attribute and locked label between them — stay outside the editing
 * surface entirely.
 */
export function scanEditableTextRuns(html: string): SlideTextRun[] {
  if (!html) return [];

  const runs: SlideTextRun[] = [];
  const stack: OpenElement[] = [];
  let lockedDepth = 0;
  let opaqueDepth = 0;
  let cursor = 0;

  const pushRun = (from: number, to: number) => {
    if (lockedDepth > 0 || opaqueDepth > 0) return;

    let start = from;
    let end = to;
    while (start < end && /\s/.test(html[start])) start++;
    while (end > start && /\s/.test(html[end - 1])) end--;
    if (start >= end) return;

    runs.push({ start, end, label: labelForStack(stack) });
  };

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);

    if (tagStart === -1) {
      pushRun(cursor, html.length);
      break;
    }
    if (tagStart > cursor) pushRun(cursor, tagStart);

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) {
      // An unterminated '<' is text, not markup — treat the remainder as prose.
      pushRun(tagStart, html.length);
      break;
    }

    const tagSource = html.slice(tagStart, tagEnd + 1);
    const nameMatch = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tagSource);

    if (nameMatch) {
      const tag = nameMatch[1].toLowerCase();
      const isClosing = tagSource[1] === '/';

      if (isClosing) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag !== tag) continue;
          for (let j = stack.length - 1; j >= i; j--) {
            if (stack[j].locked) lockedDepth--;
            if (OPAQUE_TAGS.has(stack[j].tag)) opaqueDepth--;
          }
          stack.length = i;
          break;
        }
      } else if (!VOID_TAGS.has(tag) && !tagSource.endsWith('/>')) {
        const classes = readClasses(tagSource);
        const locked = classes.some(isLockedClass);
        stack.push({ tag, classes, locked });
        if (locked) lockedDepth++;
        if (OPAQUE_TAGS.has(tag)) opaqueDepth++;
      }
    }

    cursor = tagEnd + 1;
  }

  return numberDuplicateLabels(runs);
}

/** Escape plain text for an HTML text node. `&` first, or the rest double-escape. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Render a section with each editable region wrapped in a `contenteditable`
 * span, so the admin types on the rendered slide itself.
 *
 * `edits` supplies text the admin has already typed; regions absent from it
 * render their original source slice unchanged. The result is for DISPLAY only
 * — saving goes through `applyTextRunEdits`, which never sees this string.
 */
export function buildEditableSlideHtml(
  html: string,
  runs: readonly SlideTextRun[],
  edits?: SlideRunEdits,
): string {
  let out = '';
  let cursor = 0;

  runs.forEach((run, index) => {
    const edited = edits?.[index];
    const value = edited === undefined ? html.slice(run.start, run.end) : escapeText(edited);

    out +=
      html.slice(cursor, run.start) +
      `<span class="${EDITABLE_RUN_STYLES}" ${EDITABLE_RUN_ATTRIBUTE}="${index}"` +
      ` contenteditable="true" role="textbox" aria-multiline="false"` +
      ` aria-label="${escapeAttribute(run.label)}" spellcheck="true">${value}</span>`;
    cursor = run.end;
  });

  return out + html.slice(cursor);
}

const RUN_MARKER_PATTERN = new RegExp(
  `[\\s/]${EDITABLE_RUN_ATTRIBUTE}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
  'i',
);

/** Every `data-slide-run` value on an element in `html`, in document order. */
function collectRunMarkers(html: string): string[] {
  const markers: string[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) break;

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) break;

    const match = RUN_MARKER_PATTERN.exec(html.slice(tagStart, tagEnd + 1));
    if (match) markers.push(match[1] ?? match[2] ?? match[3] ?? '');
    cursor = tagEnd + 1;
  }

  return markers;
}

/**
 * Whether `edits` can be spliced into a section without landing anywhere but
 * the region each one was typed into.
 *
 * The editor resolves a keystroke to its region through the nearest
 * `[data-slide-run]` ancestor, and course HTML is stored content: a section that
 * already carries that attribute on an element of its own would route typed
 * text into whichever region the forged index names, and the save would splice
 * it there. So the section's editable rendering must carry exactly the markers
 * `buildEditableSlideHtml` emitted — each of `0..runs.length - 1`, once — and
 * every edit must name one of them. Anything else is refused, never repaired.
 */
export function canApplyTextRunEdits(
  html: string,
  runs: readonly SlideTextRun[],
  edits: SlideRunEdits,
): boolean {
  const markers = collectRunMarkers(buildEditableSlideHtml(html, runs));
  if (markers.length !== runs.length) return false;
  if (markers.some((marker, index) => marker !== String(index))) return false;

  return Object.keys(edits).every((key) => {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < runs.length;
  });
}

/**
 * Splice edited text back into a section's own source.
 *
 * Only regions named in `edits` are rewritten; every other byte — wrapper,
 * class, badge, whitespace, entity — is carried through untouched. An empty
 * `edits` therefore returns the input unchanged.
 */
export function applyTextRunEdits(
  html: string,
  runs: readonly SlideTextRun[],
  edits: SlideRunEdits,
): string {
  let out = '';
  let cursor = 0;

  runs.forEach((run, index) => {
    const edited = edits[index];
    if (edited === undefined) return;

    out += html.slice(cursor, run.start) + escapeText(edited);
    cursor = run.end;
  });

  return out + html.slice(cursor);
}
