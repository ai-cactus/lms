import { describe, expect, test } from 'vitest';
import { splitIntoEditableSections, splitSlideContent } from './slide-splitter';

/**
 * Fixtures mirroring the exact output shape of `slidesV46ToHtml`
 * (src/components/dashboard/courses/steps/GenerationController.tsx), which is
 * what actually populates `lesson.slideContent`. Hand-written <p>-only markup
 * would not exercise the wrapper div, the badge span before the heading, or the
 * nested boxes — the structures most at risk from a splitter.
 */

const TELL_SLIDE =
  '<div class="rich-slide slide-type-tell">' +
  '<span class="slide-type-badge slide-type-badge-tell">CONCEPT</span>' +
  '<h3 class="slide-heading">Protecting Client Information</h3>' +
  '<div class="slide-core-concept"><p>Every client record you touch is protected health information.</p></div>' +
  '<ul class="slide-key-points"><li>Confirm identity before disclosing anything</li><li>Share only the minimum necessary</li></ul>' +
  '<div class="slide-terms-box">' +
  '<h4 class="slide-box-title">Key Terms</h4>' +
  '<div class="slide-term-item"><strong>PHI</strong>: Protected Health Information</div>' +
  '<div class="slide-term-item"><strong>Minimum Necessary</strong>: The least data required for the task</div>' +
  '</div>' +
  '</div>';

const SHOW_SLIDE =
  '<div class="rich-slide slide-type-show">' +
  '<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>' +
  '<h3 class="slide-heading">A Colleague Asks for a Chart</h3>' +
  '<div class="slide-core-concept"><p>Access is role-based, not relationship-based.</p></div>' +
  '<div class="slide-scenario">' +
  '<div class="scenario-label">Workplace Scenario</div>' +
  '<div class="scenario-situation"><span class="scenario-tag">Situation</span> A nurse from another unit asks you to pull a chart for her.</div>' +
  '<div class="scenario-correct"><span class="scenario-tag">Correct Action</span> Direct her to her own supervisor for access.</div>' +
  '<div class="scenario-wrong"><span class="scenario-tag">Common Mistake</span> Pulling the chart because you know and trust her.</div>' +
  '<div class="scenario-rationale"><span class="scenario-tag">Why</span> Familiarity is not authorisation.</div>' +
  '</div>' +
  '<ul class="slide-key-points"><li>Verify the treatment relationship first</li></ul>' +
  '</div>';

const DO_SLIDE =
  '<div class="rich-slide slide-type-do">' +
  '<span class="slide-type-badge slide-type-badge-do">ACTION</span>' +
  '<h3 class="slide-heading">Reporting a Suspected Breach</h3>' +
  '<ol class="slide-action-steps"><li>Stop the disclosure immediately</li><li>Notify your supervisor</li></ol>' +
  '<div class="slide-process-flow">' +
  '<div class="process-step"><span class="step-number">Step 1</span><span class="step-action">Contain the exposure</span><span class="step-why">Limits the number of records affected</span></div>' +
  '<div class="process-step"><span class="step-number">Step 2</span><span class="step-action">Report within one hour</span><span class="step-why">Regulatory notification deadline</span></div>' +
  '</div>' +
  '<div class="slide-details-box"><h4 class="slide-box-title">What You Need</h4><ul><li>Incident form</li><li>Time of discovery</li></ul></div>' +
  '</div>';

/** A single .rich-slide whose body comfortably exceeds MAX_WORDS (120). */
const LONG_SLIDE =
  '<div class="rich-slide slide-type-tell">' +
  '<span class="slide-type-badge slide-type-badge-tell">CONCEPT</span>' +
  '<h3 class="slide-heading">Documentation Standards</h3>' +
  Array.from(
    { length: 8 },
    (_, i) =>
      `<p>Paragraph ${i + 1} explains in detail why accurate and contemporaneous documentation ` +
      'protects both the client and the organisation during an audit, and describes the ' +
      'specific fields that must be completed before the end of the working shift.</p>',
  ).join('') +
  '</div>';

const LEGACY_WITH_PREAMBLE =
  '<p>This lesson introduces the core confidentiality duties owed to every client you support.</p>' +
  '<h2>Duty of Confidentiality</h2><p>Keep records secure at all times.</p>' +
  '<h3>Practical Steps</h3><p>Lock your screen whenever you step away.</p>';

const LEGACY_NO_HEADINGS =
  '<p>A short standalone lesson with no headings at all.</p><p>It still needs to round-trip.</p>';

const MIXED_DEPTHS =
  '<h2>Top Level</h2><p>Intro copy.</p>' +
  '<h3>Nested One</h3><p>Detail copy.</p>' +
  '<h3>Nested Two</h3><p>More detail.</p>' +
  '<h2>Second Top Level</h2><p>Closing copy.</p>';

const CORPUS: Array<[string, string]> = [
  ['tell slide', TELL_SLIDE],
  ['show slide', SHOW_SLIDE],
  ['do slide', DO_SLIDE],
  ['long slide', LONG_SLIDE],
  ['three slides joined', TELL_SLIDE + SHOW_SLIDE + DO_SLIDE],
  ['legacy with preamble', LEGACY_WITH_PREAMBLE],
  ['legacy without headings', LEGACY_NO_HEADINGS],
  ['mixed heading depths', MIXED_DEPTHS],
  ['empty', ''],
  ['whitespace only', '   \n  '],
  ['heading only', '<h2>Alone</h2>'],
  ['whitespace between slides', `${TELL_SLIDE}\n  \n${SHOW_SLIDE}`],
  ['unclosed rich slide', '<div class="rich-slide slide-type-tell"><p>Never closed.</p>'],
];

function reassemble(html: string): string {
  return splitIntoEditableSections(html)
    .map((section) => section.html)
    .join('');
}

describe('splitIntoEditableSections — round-trip fidelity', () => {
  test.each(CORPUS)('reproduces %s byte-for-byte', (_label, html) => {
    expect(reassemble(html)).toBe(html);
  });

  test('every byte of the input lands in exactly one section', () => {
    const sections = splitIntoEditableSections(TELL_SLIDE + SHOW_SLIDE);
    const totalLength = sections.reduce((sum, section) => sum + section.html.length, 0);
    expect(totalLength).toBe((TELL_SLIDE + SHOW_SLIDE).length);
  });
});

describe('splitIntoEditableSections — rich slide content', () => {
  test('splits a multi-slide document on .rich-slide boundaries', () => {
    const sections = splitIntoEditableSections(TELL_SLIDE + SHOW_SLIDE + DO_SLIDE);

    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.kind)).toEqual(['rich-slide', 'rich-slide', 'rich-slide']);
    expect(sections.map((s) => s.html)).toEqual([TELL_SLIDE, SHOW_SLIDE, DO_SLIDE]);
  });

  test('labels each slide with its own heading', () => {
    const sections = splitIntoEditableSections(TELL_SLIDE + SHOW_SLIDE + DO_SLIDE);

    expect(sections.map((s) => s.heading)).toEqual([
      'Protecting Client Information',
      'A Colleague Asks for a Chart',
      'Reporting a Suspected Breach',
    ]);
  });

  test('each slide section is well-formed, balanced HTML', () => {
    const sections = splitIntoEditableSections(TELL_SLIDE + SHOW_SLIDE + DO_SLIDE);

    for (const section of sections) {
      expect(section.html.startsWith('<div class="rich-slide')).toBe(true);
      expect(section.html.endsWith('</div>')).toBe(true);

      // A balanced fragment survives a parse/serialise cycle unchanged; an
      // unbalanced one gets auto-closed and comes back different.
      const container = document.createElement('div');
      container.innerHTML = section.html;
      expect(container.innerHTML).toBe(section.html);
    }
  });

  test('keeps the wrapper classes that drive slide styling', () => {
    const [tell, show, doSlide] = splitIntoEditableSections(TELL_SLIDE + SHOW_SLIDE + DO_SLIDE);

    expect(tell.html).toContain('class="rich-slide slide-type-tell"');
    expect(show.html).toContain('class="rich-slide slide-type-show"');
    expect(doSlide.html).toContain('class="rich-slide slide-type-do"');
  });

  test('preserves the full .slide-scenario block intact', () => {
    const [section] = splitIntoEditableSections(SHOW_SLIDE);

    expect(section.html).toContain('<div class="slide-scenario">');
    expect(section.html).toContain('<span class="scenario-tag">Situation</span>');
    expect(section.html).toContain('<span class="scenario-tag">Common Mistake</span>');
    expect(section.html).toContain('<span class="scenario-tag">Why</span>');
  });

  test('preserves nested .slide-process-flow steps', () => {
    const [section] = splitIntoEditableSections(DO_SLIDE);

    expect(section.html).toContain('<div class="slide-process-flow">');
    expect(section.html.match(/class="process-step"/g) ?? []).toHaveLength(2);
  });

  test('keeps inter-slide whitespace as its own gap section', () => {
    const sections = splitIntoEditableSections(`${TELL_SLIDE}\n  \n${SHOW_SLIDE}`);

    expect(sections.map((s) => s.kind)).toEqual(['rich-slide', 'gap', 'rich-slide']);
    expect(sections[1].html).toBe('\n  \n');
  });

  test('absorbs a nested .rich-slide into its ancestor rather than mis-splitting', () => {
    const nested =
      '<div class="rich-slide slide-type-tell"><p>Outer</p>' +
      '<div class="rich-slide slide-type-do"><p>Inner</p></div>' +
      '</div>';
    const sections = splitIntoEditableSections(nested);

    expect(sections).toHaveLength(1);
    expect(sections[0].html).toBe(nested);
  });

  test('matches rich-slide as a class token, not a substring', () => {
    const decoy = '<div class="not-rich-slide"><p>Decoy</p></div>';

    expect(splitIntoEditableSections(decoy).every((s) => s.kind !== 'rich-slide')).toBe(true);
    expect(reassemble(decoy)).toBe(decoy);
  });

  test('an unclosed .rich-slide still round-trips', () => {
    const unclosed = '<div class="rich-slide slide-type-tell"><p>Never closed.</p>';
    const sections = splitIntoEditableSections(unclosed);

    expect(sections).toHaveLength(1);
    expect(sections[0].html).toBe(unclosed);
  });
});

describe('splitIntoEditableSections — content without .rich-slide markup', () => {
  test('falls back to heading sections and keeps heading markup verbatim', () => {
    const sections = splitIntoEditableSections(MIXED_DEPTHS);

    expect(sections.map((s) => s.heading)).toEqual([
      'Top Level',
      'Nested One',
      'Nested Two',
      'Second Top Level',
    ]);
    expect(sections.every((s) => s.kind === 'heading-section')).toBe(true);
    expect(sections[0].html.startsWith('<h2>Top Level</h2>')).toBe(true);
  });

  test('keeps a leading preamble before the first heading', () => {
    const sections = splitIntoEditableSections(LEGACY_WITH_PREAMBLE);

    expect(sections[0].kind).toBe('gap');
    expect(sections[0].html).toBe(
      '<p>This lesson introduces the core confidentiality duties owed to every client you support.</p>',
    );
    expect(sections.slice(1).map((s) => s.heading)).toEqual([
      'Duty of Confidentiality',
      'Practical Steps',
    ]);
  });

  test('treats a document with no headings as one implicit section', () => {
    const sections = splitIntoEditableSections(LEGACY_NO_HEADINGS);

    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe('heading-section');
    expect(sections[0].heading).toBe('');
    expect(sections[0].html).toBe(LEGACY_NO_HEADINGS);
  });

  test('retains heading attributes that a reconstructed tag would drop', () => {
    const withAttrs = '<h3 class="slide-heading" id="intro">Intro</h3><p>Body.</p>';
    const [section] = splitIntoEditableSections(withAttrs);

    expect(section.html).toContain('class="slide-heading"');
    expect(section.html).toContain('id="intro"');
  });

  test('returns no sections for empty input', () => {
    expect(splitIntoEditableSections('')).toEqual([]);
  });

  test('preserves whitespace-only input as a single section', () => {
    const sections = splitIntoEditableSections('   \n  ');

    expect(sections).toHaveLength(1);
    expect(sections[0].html).toBe('   \n  ');
  });
});

describe('splitIntoEditableSections — editing unit vs reading unit', () => {
  test('does not fragment a slide that the reading splitter paginates', () => {
    const pages = splitSlideContent(LONG_SLIDE);
    const sections = splitIntoEditableSections(LONG_SLIDE);

    // The reading unit splits this for comfort; the editing unit must not, or
    // the editor would save back a fragment in place of the whole slide.
    expect(pages.length).toBeGreaterThan(1);
    expect(sections).toHaveLength(1);
    expect(sections[0].html).toBe(LONG_SLIDE);
  });

  test('reading pages cannot be reassembled, editing sections can', () => {
    const fromPages = splitSlideContent(LONG_SLIDE)
      .map((page) => page.html)
      .join('');

    expect(fromPages).not.toBe(LONG_SLIDE);
    expect(reassemble(LONG_SLIDE)).toBe(LONG_SLIDE);
  });
});

/**
 * `splitSlideContent` drives the learner's reading pagination and is shipped
 * behaviour. Extracting the shared boundary scan must not have moved it by a
 * single byte, so the pre-refactor implementation is vendored here verbatim and
 * the two are compared across the whole corpus. Golden strings would pin only
 * the shapes someone thought to transcribe; this pins the function.
 */
function legacyWordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

function legacyExtractHeadingText(tagHtml: string): string {
  return tagHtml.replace(/<[^>]+>/g, '').trim();
}

function legacySplitByParagraphs(
  heading: string,
  html: string,
): Array<{ heading: string; html: string }> {
  const blockSplitRe = /(<\/(?:p|li|blockquote|div|section)>)/gi;
  const parts = html.split(blockSplitRe);

  const pages: Array<{ heading: string; html: string }> = [];
  let buffer = '';

  for (const part of parts) {
    buffer += part;
    if (legacyWordCount(buffer) >= 120) {
      pages.push({ heading: pages.length === 0 ? heading : '', html: buffer });
      buffer = '';
    }
  }

  if (buffer.trim()) {
    pages.push({ heading: pages.length === 0 ? heading : '', html: buffer });
  }

  return pages.length > 0 ? pages : [{ heading, html }];
}

function legacySplitSlideContent(rawHtml: string): Array<{ heading: string; html: string }> {
  if (!rawHtml || !rawHtml.trim()) {
    return [{ heading: '', html: '' }];
  }

  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;

  const sections: Array<{ heading: string; rawHtml: string }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(rawHtml)) !== null) {
    const beforeHeading = rawHtml.slice(cursor, match.index).trim();

    if (beforeHeading) {
      if (sections.length === 0) {
        sections.push({ heading: '', rawHtml: beforeHeading });
      } else {
        sections[sections.length - 1].rawHtml += ' ' + beforeHeading;
      }
    }

    sections.push({ heading: legacyExtractHeadingText(match[0]), rawHtml: '' });

    cursor = match.index + match[0].length;
  }

  const tail = rawHtml.slice(cursor).trim();
  if (tail) {
    if (sections.length === 0) {
      sections.push({ heading: '', rawHtml: tail });
    } else {
      sections[sections.length - 1].rawHtml += ' ' + tail;
    }
  }

  if (sections.length === 0) {
    sections.push({ heading: '', rawHtml: rawHtml.trim() });
  }

  const pages: Array<{ heading: string; html: string }> = [];

  for (const section of sections) {
    const isEmptyPreamble = !section.heading && !section.rawHtml.trim();
    if (isEmptyPreamble) continue;

    const shortPreamble = !section.heading && legacyWordCount(section.rawHtml) <= 10;
    if (shortPreamble) continue;

    if (legacyWordCount(section.rawHtml) <= 120) {
      pages.push({ heading: section.heading, html: section.rawHtml });
    } else {
      pages.push(...legacySplitByParagraphs(section.heading, section.rawHtml));
    }
  }

  return pages.length > 0 ? pages : [{ heading: '', html: rawHtml }];
}

describe('splitSlideContent — unchanged by the shared boundary scan', () => {
  test.each(CORPUS)('matches the pre-refactor output for %s', (_label, html) => {
    expect(splitSlideContent(html)).toEqual(legacySplitSlideContent(html));
  });

  test('still paginates a long section at paragraph boundaries', () => {
    const pages = splitSlideContent(LONG_SLIDE);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].heading).toBe('Documentation Standards');
  });

  test('still returns a single empty page for blank input', () => {
    expect(splitSlideContent('')).toEqual([{ heading: '', html: '' }]);
    expect(splitSlideContent('   ')).toEqual([{ heading: '', html: '' }]);
  });
});
