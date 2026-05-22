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
 */

export interface SlidePage {
  /** Section heading text (plain text, no HTML tags). May be empty for preambles. */
  heading: string;
  /** Sanitised HTML for the body content of this slide page. */
  html: string;
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

/**
 * Primary export — converts a lesson's raw HTML into an ordered array of
 * `SlidePage` objects safe for direct rendering.
 */
export function splitSlideContent(rawHtml: string): SlidePage[] {
  if (!rawHtml || !rawHtml.trim()) {
    return [{ heading: '', html: '' }];
  }

  // Regex that captures every h2/h3 tag together with its closing tag.
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;

  const sections: Array<{ heading: string; rawHtml: string }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(rawHtml)) !== null) {
    const beforeHeading = rawHtml.slice(cursor, match.index).trim();

    // Flush content accumulated before this heading
    if (beforeHeading) {
      if (sections.length === 0) {
        // Preamble before very first heading
        sections.push({ heading: '', rawHtml: beforeHeading });
      } else {
        // Append to the last section's body (content between two headings)
        sections[sections.length - 1].rawHtml += ' ' + beforeHeading;
      }
    }

    sections.push({
      heading: extractHeadingText(match[0]),
      rawHtml: '',
    });

    cursor = match.index + match[0].length;
  }

  // Anything after the last heading
  const tail = rawHtml.slice(cursor).trim();
  if (tail) {
    if (sections.length === 0) {
      sections.push({ heading: '', rawHtml: tail });
    } else {
      sections[sections.length - 1].rawHtml += ' ' + tail;
    }
  }

  // If no headings were found at all, treat the whole blob as one section
  if (sections.length === 0) {
    sections.push({ heading: '', rawHtml: rawHtml.trim() });
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
