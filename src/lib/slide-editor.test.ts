import { describe, expect, test } from 'vitest';

import {
  applyTextRunEdits,
  buildEditableSlideHtml,
  canApplyTextRunEdits,
  scanEditableTextRuns,
  EDITABLE_RUN_ATTRIBUTE,
} from './slide-editor';
import { splitIntoEditableSections } from './slide-splitter';
import { sanitizeEditableHtml } from './sanitize';

/**
 * Fixtures mirroring the exact output shape of `slidesV46ToHtml`
 * (src/components/dashboard/courses/steps/GenerationController.tsx), which is
 * what actually populates `lesson.slideContent`. Hand-written <p>-only markup
 * would not exercise the wrapper div, the locked badge, or `.slide-scenario` —
 * the block with the most interleaving of fixed labels and free prose, and so
 * the one a DOM-walk bug shows up in first.
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
  '</div>' +
  '</div>';

const SHOW_SLIDE =
  '<div class="rich-slide slide-type-show">' +
  '<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>' +
  '<h3 class="slide-heading">A Colleague Asks for a Chart</h3>' +
  '<div class="slide-scenario">' +
  '<div class="scenario-label">Workplace Scenario</div>' +
  '<div class="scenario-situation"><span class="scenario-tag">Situation</span> A nurse from another unit asks you to pull a chart for her.</div>' +
  '<div class="scenario-correct"><span class="scenario-tag">Correct Action</span> Direct her to her own supervisor for access.</div>' +
  '<div class="scenario-wrong"><span class="scenario-tag">Common Mistake</span> Pulling the chart because you know and trust her.</div>' +
  '<div class="scenario-rationale"><span class="scenario-tag">Why</span> Familiarity is not authorisation.</div>' +
  '</div>' +
  '</div>';

const DO_SLIDE =
  '<div class="rich-slide slide-type-do">' +
  '<span class="slide-type-badge slide-type-badge-do">ACTION</span>' +
  '<h3 class="slide-heading">Reporting a Suspected Breach</h3>' +
  '<ol class="slide-action-steps"><li>Stop the disclosure immediately</li><li>Notify your supervisor</li></ol>' +
  '<div class="slide-process-flow">' +
  '<div class="process-step"><span class="step-number">Step 1</span><span class="step-action">Contain the exposure</span><span class="step-why">Limits the number of records affected</span></div>' +
  '</div>' +
  '</div>';

/** Whitespace between slides is a `gap` section and must survive reassembly. */
const DECK = `${TELL_SLIDE}\n  ${SHOW_SLIDE}\n  ${DO_SLIDE}`;

/**
 * The markup skeleton, extracted without going through the module under test so
 * a scanner bug cannot make this assertion agree with itself.
 */
function tagSkeleton(html: string): string {
  return (html.match(/<[^>]+>/g) ?? []).join('');
}

function runTexts(html: string): string[] {
  return scanEditableTextRuns(html).map((run) => html.slice(run.start, run.end));
}

/** Rebuild a whole deck the way `AdminSlideEditor` does on save. */
function saveDeck(deck: string, edits: Record<number, Record<number, string>>): string {
  return splitIntoEditableSections(deck)
    .map((section, index) => {
      const sectionEdits = edits[index];
      if (!sectionEdits) return section.html;
      return applyTextRunEdits(section.html, scanEditableTextRuns(section.html), sectionEdits);
    })
    .join('');
}

describe('scanEditableTextRuns', () => {
  test('finds every authored text region of a TELL slide', () => {
    expect(runTexts(TELL_SLIDE)).toEqual([
      'Protecting Client Information',
      'Every client record you touch is protected health information.',
      'Confirm identity before disclosing anything',
      'Share only the minimum necessary',
      'Key Terms',
      'PHI',
      ': Protected Health Information',
    ]);
  });

  test('locks the slide-type badge — its text is never an editable region', () => {
    expect(runTexts(TELL_SLIDE)).not.toContain('CONCEPT');
    expect(runTexts(SHOW_SLIDE)).not.toContain('SCENARIO');
    expect(runTexts(DO_SLIDE)).not.toContain('ACTION');
  });

  test('locks every scenario tag while leaving the prose beside it editable', () => {
    const texts = runTexts(SHOW_SLIDE);

    expect(texts).not.toContain('Situation');
    expect(texts).not.toContain('Correct Action');
    expect(texts).not.toContain('Common Mistake');
    expect(texts).not.toContain('Why');

    expect(texts).toEqual([
      'A Colleague Asks for a Chart',
      'Workplace Scenario',
      'A nurse from another unit asks you to pull a chart for her.',
      'Direct her to her own supervisor for access.',
      'Pulling the chart because you know and trust her.',
      'Familiarity is not authorisation.',
    ]);
  });

  test('keeps process-step text editable', () => {
    expect(runTexts(DO_SLIDE)).toEqual([
      'Reporting a Suspected Breach',
      'Stop the disclosure immediately',
      'Notify your supervisor',
      'Step 1',
      'Contain the exposure',
      'Limits the number of records affected',
    ]);
  });

  test('names each region after its semantic role, numbering repeats', () => {
    const labels = scanEditableTextRuns(TELL_SLIDE).map((run) => run.label);

    expect(labels).toEqual([
      'Slide heading',
      'Core concept',
      'Key point 1',
      'Key point 2',
      'Box title',
      'Key term 1',
      'Key term 2',
    ]);
  });

  test('names regions of legacy article HTML after their element', () => {
    const labels = scanEditableTextRuns(
      '<h2>Hand Hygiene</h2><p>Wash before and after.</p><ul><li>Soap</li></ul>',
    ).map((run) => run.label);

    expect(labels).toEqual(['Slide heading', 'Paragraph', 'List item']);
  });

  test('ignores whitespace between elements', () => {
    expect(scanEditableTextRuns('<ul class="x">\n  <li>One</li>\n</ul>')).toHaveLength(1);
  });
});

describe('applyTextRunEdits', () => {
  test('returns the input unchanged when nothing was edited', () => {
    for (const slide of [TELL_SLIDE, SHOW_SLIDE, DO_SLIDE, DECK]) {
      expect(applyTextRunEdits(slide, scanEditableTextRuns(slide), {})).toBe(slide);
    }
  });

  test('a real edit changes that text and nothing else — byte for byte', () => {
    const runs = scanEditableTextRuns(SHOW_SLIDE);
    const situation = runs.findIndex(
      (run) =>
        SHOW_SLIDE.slice(run.start, run.end) ===
        'A nurse from another unit asks you to pull a chart for her.',
    );
    expect(situation).toBeGreaterThan(-1);

    const edited = applyTextRunEdits(SHOW_SLIDE, runs, {
      [situation]: 'A nurse from another unit asks you to print a chart for her.',
    });

    expect(edited).not.toBe(SHOW_SLIDE);
    expect(edited).toContain('asks you to print a chart');
    // Every wrapper, class and locked label is byte-identical...
    expect(tagSkeleton(edited)).toBe(tagSkeleton(SHOW_SLIDE));
    expect(edited).toContain(
      '<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>',
    );
    expect(edited).toContain('<span class="scenario-tag">Situation</span>');
    // ...and undoing the one text change restores the source exactly.
    expect(edited.replace('print a chart', 'pull a chart')).toBe(SHOW_SLIDE);
  });

  test('escapes typed text so markup cannot be authored through a region', () => {
    const runs = scanEditableTextRuns(TELL_SLIDE);
    const edited = applyTextRunEdits(TELL_SLIDE, runs, {
      0: '<div class="rich-slide">pasted & <b>bold</b></div>',
    });

    expect(edited).toContain(
      '<h3 class="slide-heading">&lt;div class="rich-slide"&gt;pasted &amp; &lt;b&gt;bold&lt;/b&gt;&lt;/div&gt;</h3>',
    );
    expect(tagSkeleton(edited)).toBe(tagSkeleton(TELL_SLIDE));
  });

  test('leaves entities in untouched regions exactly as authored', () => {
    const html =
      '<div class="rich-slide"><h3 class="slide-heading">Consent &amp; Capacity</h3>' +
      '<p>Ask&nbsp;first.</p></div>';
    const runs = scanEditableTextRuns(html);

    const edited = applyTextRunEdits(html, runs, { 0: 'Consent and Capacity' });

    expect(edited).toContain('Ask&nbsp;first.');
    expect(edited).toContain('<h3 class="slide-heading">Consent and Capacity</h3>');
  });

  test('accepts a cleared region', () => {
    const runs = scanEditableTextRuns(TELL_SLIDE);
    const edited = applyTextRunEdits(TELL_SLIDE, runs, { 0: '' });

    expect(edited).toContain('<h3 class="slide-heading"></h3>');
    expect(tagSkeleton(edited)).toBe(tagSkeleton(TELL_SLIDE));
  });
});

describe('deck round trip', () => {
  test('reassembling an unedited deck reproduces the source exactly', () => {
    expect(saveDeck(DECK, {})).toBe(DECK);
  });

  test('editing one slide leaves every other section and gap byte-identical', () => {
    const sections = splitIntoEditableSections(DECK);
    const showIndex = sections.findIndex((section) => section.html === SHOW_SLIDE);
    expect(showIndex).toBeGreaterThan(-1);

    const runs = scanEditableTextRuns(sections[showIndex].html);
    const rationale = runs.findIndex(
      (run) =>
        sections[showIndex].html.slice(run.start, run.end) === 'Familiarity is not authorisation.',
    );

    const saved = saveDeck(DECK, {
      [showIndex]: { [rationale]: 'Familiarity is not authorization.' },
    });

    expect(saved).toContain('Familiarity is not authorization.');
    expect(tagSkeleton(saved)).toBe(tagSkeleton(DECK));
    expect(saved.replace('authorization', 'authorisation')).toBe(DECK);
  });
});

describe('buildEditableSlideHtml', () => {
  test('wraps every editable region and no locked one', () => {
    const runs = scanEditableTextRuns(SHOW_SLIDE);
    const built = buildEditableSlideHtml(SHOW_SLIDE, runs);

    expect(built.match(new RegExp(EDITABLE_RUN_ATTRIBUTE, 'g'))).toHaveLength(runs.length);
    expect(built).toContain('<span class="slide-type-badge slide-type-badge-show">SCENARIO</span>');
    expect(built).toContain('<span class="scenario-tag">Situation</span>');
    expect(built).toContain('aria-label="Scenario situation"');
  });

  test('renders text the admin has already typed, escaped', () => {
    const runs = scanEditableTextRuns(TELL_SLIDE);
    const built = buildEditableSlideHtml(TELL_SLIDE, runs, { 0: 'Guarding <PHI>' });

    expect(built).toContain('>Guarding &lt;PHI&gt;</span>');
  });

  test('survives the editor sanitizer with its editing attributes intact', () => {
    const runs = scanEditableTextRuns(TELL_SLIDE);
    const sanitized = sanitizeEditableHtml(buildEditableSlideHtml(TELL_SLIDE, runs));

    expect(sanitized).toContain('contenteditable="true"');
    expect(sanitized).toContain(`${EDITABLE_RUN_ATTRIBUTE}="0"`);
    expect(sanitized).toContain('role="textbox"');
    expect(sanitized).toContain('class="rich-slide slide-type-tell"');
  });
});

/**
 * Course HTML is stored content, so it can already carry the editor's own
 * region attribute. The editor maps a keystroke to a region through the nearest
 * `[data-slide-run]`, so a forged one would route typed text into another
 * region and the save would splice it there. Refused, never repaired.
 */
describe('canApplyTextRunEdits', () => {
  const forge = (marker: string) =>
    TELL_SLIDE.replace('>CONCEPT</span>', `><span ${marker}>CONCEPT</span></span>`);

  test('accepts every clean v4.6 section with in-range edits', () => {
    for (const slide of [TELL_SLIDE, SHOW_SLIDE, DO_SLIDE]) {
      const runs = scanEditableTextRuns(slide);
      const everyRun = Object.fromEntries(runs.map((_, index) => [index, 'x']));
      expect(canApplyTextRunEdits(slide, runs, everyRun)).toBe(true);
    }
  });

  test('accepts an empty edit set on a clean section', () => {
    expect(canApplyTextRunEdits(TELL_SLIDE, scanEditableTextRuns(TELL_SLIDE), {})).toBe(true);
  });

  test.each([
    ['a forged in-range index', 'data-slide-run="0"'],
    ['a forged out-of-range index', 'data-slide-run="99"'],
    ['an unquoted attribute', 'data-slide-run=1'],
    ['a single-quoted attribute', "data-slide-run='2'"],
    ['an upper-case attribute name', 'DATA-SLIDE-RUN="0"'],
    ['a non-canonical index', 'data-slide-run=" 0"'],
  ])('refuses a section carrying %s', (_, marker) => {
    const html = forge(marker);
    expect(canApplyTextRunEdits(html, scanEditableTextRuns(html), { 0: 'x' })).toBe(false);
  });

  // HTML treats `/` between attributes as a separator, so a browser reads this
  // span as carrying the attribute even with no whitespace before it.
  test('refuses a forged attribute separated by a slash', () => {
    const html = TELL_SLIDE.replace(
      '>CONCEPT</span>',
      '><span/data-slide-run="0">CONCEPT</span></span>',
    );
    expect(canApplyTextRunEdits(html, scanEditableTextRuns(html), { 0: 'x' })).toBe(false);
  });

  test('refuses even when the forged marker wraps no editable text', () => {
    const html = TELL_SLIDE.replace('</div>', '<br data-slide-run="1"></div>');
    expect(canApplyTextRunEdits(html, scanEditableTextRuns(html), {})).toBe(false);
  });

  test('ignores the attribute inside a comment, which the browser never renders', () => {
    const html = TELL_SLIDE.replace('</h3>', '</h3><!-- <span data-slide-run="0"> -->');
    expect(canApplyTextRunEdits(html, scanEditableTextRuns(html), { 0: 'x' })).toBe(true);
  });

  test.each([[-1], [99], [1.5]])(
    'refuses an edit keyed to run %s, which was never emitted',
    (key) => {
      const runs = scanEditableTextRuns(TELL_SLIDE);
      expect(canApplyTextRunEdits(TELL_SLIDE, runs, { [key]: 'x' })).toBe(false);
    },
  );
});
