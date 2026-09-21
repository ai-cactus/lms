/**
 * slide-splitter.ts
 *
 * Splits a single lesson's HTML content blob into slide-sized pages.
 * Strategy (mirrors top LMS conventions: LinkedIn Learning, Coursera):
 *   1. Split at every <h2> / <h3> heading — "one concept per slide".
 *   2. If any resulting chunk still exceeds MAX_WORDS, further split at
 *      paragraph boundaries so no slide is a wall of text.
 *   3. A short preamble before the first heading is treated as its own slide
 *      only when it has meaningful content (> 10 words).
 *
 * Each page carries an optional heading and an HTML body fragment.
 *
 * Two different splits live in this file and they are NOT interchangeable:
 *
 *   (a) `splitIntoEditableSections` — authored units, preserved byte-for-byte at
 *       their original offsets, so the list reassembles into the source exactly.
 *       This is the safe unit to EDIT.
 *   (b) `splitSlideContent` — reading pages. It cuts at <h2>/<h3>, then trims,
 *       drops trivial preambles and force-splits anything over MAX_WORDS by
 *       concatenating string fragments, all for reading comfort. Those pages
 *       retain no offset back into the source and, on v4.6 content, cut across
 *       the `.rich-slide` wrapper so each fragment is unbalanced HTML that only
 *       renders because the browser auto-closes tags. They cannot be reassembled
 *       losslessly. This is the unit to READ, never the unit to edit — saving a
 *       reading page back over the source would corrupt authored content.
 */

export interface SlidePage {
  /** Section heading text (plain text, no HTML tags). May be empty for preambles. */
  heading: string;
  /** Sanitised HTML for the body content of this slide page. */
  html: string;
}

/**
 * How an editable section was delimited.
 *
 * - `rich-slide` — a complete, well-formed `.rich-slide` element as emitted by
 *   `slidesV46ToHtml` (v4.6 generated slide content).
 * - `heading-section` — an <h2>/<h3>-bounded run, used for lesson HTML that has
 *   no `.rich-slide` markup (legacy lessons, article content shown via the
 *   `slideContent || content` fallback). Includes its own heading element.
 * - `gap` — content sitting between or outside the units above (usually
 *   whitespace). Retained so the section list reproduces its input exactly;
 *   not meant to be presented as an editable slide.
 */
export type EditableSectionKind = 'rich-slide' | 'heading-section' | 'gap';

/** One authored, independently editable unit of a lesson. */
export interface EditableSection {
  /** Heading plain text for labelling the unit in an editor. '' when it has none. */
  heading: string;
  /**
   * The unit's complete source text, verbatim — for `rich-slide` the whole
   * wrapper element including its classes, for `heading-section` the heading
   * element plus its body.
   *
   * Carrying the markup rather than a reconstructed tag is deliberate: rebuilding
   * a heading from its plain text would drop attributes such as
   * `class="slide-heading"`, which carry the slide's styling.
   */
  html: string;
  kind: EditableSectionKind;
}

/** Maximum words per slide page before we force-split at paragraph boundaries. */
const MAX_WORDS = 120;

/** Strip all HTML tags to count plain-text words. */
function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

/** Extract heading plain-text from an opening tag + content + closing tag. */
function extractHeadingText(tagHtml: string): string {
  return tagHtml.replace(/<[^>]+>/g, '').trim();
}

interface HeadingBoundary {
  /** Source offset where the heading element begins. */
  headingStart: number;
  headingText: string;
  /** Source offset immediately after the heading element. */
  bodyStart: number;
  /** Source offset where the next heading begins, or the end of input. */
  bodyEnd: number;
}

interface HeadingScan {
  /** Offset at which the first heading begins; the input length when there is none. */
  preambleEnd: number;
  boundaries: HeadingBoundary[];
}

/**
 * Locate every <h2>/<h3> boundary, recording source offsets rather than copied
 * strings. Shared by both splitters so the editing unit and the reading unit can
 * never disagree about where a run starts.
 */
function scanHeadingBoundaries(rawHtml: string): HeadingScan {
  // Unchanged from the original page splitter — adding a word boundary here
  // would alter which inputs match, and pagination must stay byte-identical.
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;

  const boundaries: HeadingBoundary[] = [];
  let preambleEnd = rawHtml.length;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(rawHtml)) !== null) {
    if (boundaries.length === 0) {
      preambleEnd = match.index;
    } else {
      boundaries[boundaries.length - 1].bodyEnd = match.index;
    }

    boundaries.push({
      headingStart: match.index,
      headingText: extractHeadingText(match[0]),
      bodyStart: match.index + match[0].length,
      bodyEnd: rawHtml.length,
    });
  }

  return { preambleEnd, boundaries };
}

/** Does this opening <div> tag carry `rich-slide` as one of its classes? */
function isRichSlideOpenTag(tag: string): boolean {
  const classMatch = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  if (!classMatch) return false;

  const value = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '';
  // Token match, so `rich-slide-legacy` or `not-rich-slide` do not qualify.
  return value.split(/\s+/).includes('rich-slide');
}

/**
 * Find each top-level `.rich-slide` element by walking <div> tags and tracking
 * nesting depth.
 *
 * A depth scan rather than a DOM parse: parsing and re-serialising normalises
 * attribute quoting, entity escaping and void elements, which would silently
 * rewrite authored content — and byte-exact round-trip is the entire purpose of
 * this function. A depth scan never copies or rewrites, it only records offsets.
 *
 * A `.rich-slide` nested inside another is absorbed into its ancestor rather
 * than split out separately, which is what "top-level" has to mean for the
 * outer element to stay well-formed.
 */
function findRichSlideRanges(html: string): Array<{ start: number; end: number }> {
  const divTagRe = /<(\/?)div\b[^>]*>/gi;
  const ranges: Array<{ start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  let start = -1;
  let depth = 0;

  while ((match = divTagRe.exec(html)) !== null) {
    const isClosing = match[1] === '/';

    if (start === -1) {
      if (!isClosing && isRichSlideOpenTag(match[0])) {
        start = match.index;
        depth = 1;
      }
      continue;
    }

    depth += isClosing ? -1 : 1;

    if (depth === 0) {
      ranges.push({ start, end: match.index + match[0].length });
      start = -1;
    }
  }

  // An unclosed `.rich-slide` runs to the end of input. Emitting it anyway keeps
  // the round-trip exact; dropping it would silently discard content.
  if (start !== -1) {
    ranges.push({ start, end: html.length });
  }

  return ranges;
}

/**
 * Split a large body chunk into multiple sub-pages at paragraph / list-item
 * boundaries so each stays within MAX_WORDS.
 */
function splitByParagraphs(heading: string, html: string): SlidePage[] {
  // Break on block-level elements
  const blockSplitRe = /(<\/(?:p|li|blockquote|div|section)>)/gi;
  const parts = html.split(blockSplitRe);

  const pages: SlidePage[] = [];
  let buffer = '';

  for (const part of parts) {
    buffer += part;
    if (wordCount(buffer) >= MAX_WORDS) {
      pages.push({ heading: pages.length === 0 ? heading : '', html: buffer });
      buffer = '';
    }
  }

  if (buffer.trim()) {
    pages.push({ heading: pages.length === 0 ? heading : '', html: buffer });
  }

  return pages.length > 0 ? pages : [{ heading, html }];
}

/** Heading text of the first <h2>/<h3> inside a fragment, for labelling. */
function firstHeadingText(html: string): string {
  const match = /<h[23][^>]*>[\s\S]*?<\/h[23]>/i.exec(html);
  return match ? extractHeadingText(match[0]) : '';
}

function pushGap(sections: EditableSection[], html: string, start: number, end: number): void {
  if (end > start) {
    sections.push({ heading: '', html: html.slice(start, end), kind: 'gap' });
  }
}

/**
 * Split a lesson's HTML into independently editable sections, preserving every
 * byte at its original offset.
 *
 * v4.6 generated content splits on top-level `.rich-slide` elements, so each
 * section is one complete, well-formed slide including its wrapper and classes.
 * Content with no `.rich-slide` markup at all — legacy lessons, and article HTML
 * reaching the slide view through the `slideContent || content` fallback —
 * splits at <h2>/<h3> instead, each section carrying its own heading element.
 *
 * The result reassembles into the exact input for both populations:
 *
 * ```ts
 * splitIntoEditableSections(html)
 *   .map((s) => s.html)
 *   .join('') === html;
 * ```
 *
 * Unlike `splitSlideContent` this never trims, never drops a short or empty
 * preamble and never force-splits on length — each of those would make the
 * output unable to reproduce its own input, which is what makes this the unit
 * safe to edit and save back.
 */
export function splitIntoEditableSections(html: string): EditableSection[] {
  if (!html) return [];

  const sections: EditableSection[] = [];
  const richSlides = findRichSlideRanges(html);

  if (richSlides.length > 0) {
    let cursor = 0;

    for (const range of richSlides) {
      pushGap(sections, html, cursor, range.start);

      const slideHtml = html.slice(range.start, range.end);
      sections.push({
        heading: firstHeadingText(slideHtml),
        html: slideHtml,
        kind: 'rich-slide',
      });

      cursor = range.end;
    }

    pushGap(sections, html, cursor, html.length);
    return sections;
  }

  const { preambleEnd, boundaries } = scanHeadingBoundaries(html);

  // Keyed on raw length, not trimmed content, so whitespace-only leading
  // content still round-trips.
  if (preambleEnd > 0) {
    sections.push({
      heading: '',
      html: html.slice(0, preambleEnd),
      kind: boundaries.length > 0 ? 'gap' : 'heading-section',
    });
  }

  for (const boundary of boundaries) {
    sections.push({
      heading: boundary.headingText,
      html: html.slice(boundary.headingStart, boundary.bodyEnd),
      kind: 'heading-section',
    });
  }

  return sections;
}

/**
 * Primary export — converts a lesson's raw HTML into an ordered array of
 * `SlidePage` objects safe for direct rendering.
 */
export function splitSlideContent(rawHtml: string): SlidePage[] {
  if (!rawHtml || !rawHtml.trim()) {
    return [{ heading: '', html: '' }];
  }

  const { preambleEnd, boundaries } = scanHeadingBoundaries(rawHtml);

  const sections: Array<{ heading: string; rawHtml: string }> = [];

  const preamble = rawHtml.slice(0, preambleEnd).trim();
  if (preamble) {
    sections.push({ heading: '', rawHtml: preamble });
  }

  for (const boundary of boundaries) {
    sections.push({ heading: boundary.headingText, rawHtml: '' });

    // Content between this heading and the next belongs to this section.
    const body = rawHtml.slice(boundary.bodyStart, boundary.bodyEnd).trim();
    if (body) {
      sections[sections.length - 1].rawHtml += ' ' + body;
    }
  }

  // Now expand each section into pages, enforcing MAX_WORDS
  const pages: SlidePage[] = [];

  for (const section of sections) {
    // Drop empty preambles (e.g. just whitespace before first heading)
    const isEmptyPreamble = !section.heading && !section.rawHtml.trim();
    if (isEmptyPreamble) continue;

    const shortPreamble = !section.heading && wordCount(section.rawHtml) <= 10;
    if (shortPreamble) continue; // Skip trivially short intros

    if (wordCount(section.rawHtml) <= MAX_WORDS) {
      pages.push({ heading: section.heading, html: section.rawHtml });
    } else {
      pages.push(...splitByParagraphs(section.heading, section.rawHtml));
    }
  }

  return pages.length > 0 ? pages : [{ heading: '', html: rawHtml }];
}
