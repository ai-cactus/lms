/**
 * Tests for the step-7 review helpers: read-time estimation and the heading
 * anchoring the Table of Content depends on.
 */
import { describe, it, expect } from 'vitest';

import { estimateReadMinutes, htmlToPlainText, withHeadingAnchors } from './reviewContent';

describe('htmlToPlainText', () => {
  it('strips tags and decodes the entities the pipeline emits', () => {
    expect(htmlToPlainText('<p>Risk &amp; <strong>control</strong></p>')).toBe('Risk & control');
  });
});

describe('estimateReadMinutes', () => {
  it('never reports less than a minute', () => {
    expect(estimateReadMinutes('<p>Short.</p>')).toBe(1);
  });

  it('scales with the word count', () => {
    const html = `<p>${'word '.repeat(600)}</p>`;
    expect(estimateReadMinutes(html)).toBe(3);
  });
});

describe('withHeadingAnchors', () => {
  it('stamps ids on h2–h4 and returns them in document order', () => {
    const { html, headings } = withHeadingAnchors(
      '<h2>First</h2><p>Body</p><h4 class="x">Second</h4>',
      'lesson-0',
    );

    expect(headings).toEqual([
      { id: 'lesson-0-h0', text: 'First' },
      { id: 'lesson-0-h1', text: 'Second' },
    ]);
    expect(html).toContain('<h2 id="lesson-0-h0">First</h2>');
    expect(html).toContain('<h4 class="x" id="lesson-0-h1">Second</h4>');
  });

  it('leaves body copy untouched when there are no headings', () => {
    expect(withHeadingAnchors('<p>Body</p>', 'lesson-0')).toEqual({
      html: '<p>Body</p>',
      headings: [],
    });
  });

  it('returns nothing for empty content', () => {
    expect(withHeadingAnchors('', 'lesson-0')).toEqual({ html: '', headings: [] });
  });
});
