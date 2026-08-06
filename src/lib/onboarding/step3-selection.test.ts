/**
 * Unit tests for step3-selection.ts — the pure resolve/hydrate helpers that
 * convert between step 3's form state (a set of canonical ids plus a separate
 * "other" free-text box) and the persisted shape (an array/string of ids and,
 * for "Other" selections, the raw typed text with no id at all).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSelection,
  resolveSingleSelection,
  hydrateSelection,
  hydrateSingleSelection,
} from './step3-selection';
import { OTHER_OPTION_ID } from '@/lib/constants/onboarding-options';

const KNOWN_IDS = new Set(['alpha', 'beta', 'gamma']);

describe('resolveSelection', () => {
  it('passes through known ids unchanged', () => {
    expect(resolveSelection(['alpha', 'beta'], '')).toEqual(['alpha', 'beta']);
  });

  it('replaces the "other" id with the trimmed other text', () => {
    expect(resolveSelection(['alpha', OTHER_OPTION_ID], '  Custom Type  ')).toEqual([
      'alpha',
      'Custom Type',
    ]);
  });

  it('drops the "other" entry entirely when the other text is blank', () => {
    expect(resolveSelection(['alpha', OTHER_OPTION_ID], '   ')).toEqual(['alpha']);
  });

  it('drops the "other" entry when other text is the empty string', () => {
    expect(resolveSelection([OTHER_OPTION_ID], '')).toEqual([]);
  });

  it('returns an empty array for an empty selection', () => {
    expect(resolveSelection([], 'unused text')).toEqual([]);
  });
});

describe('resolveSingleSelection', () => {
  it('passes through a known id unchanged', () => {
    expect(resolveSingleSelection('alpha', '')).toBe('alpha');
  });

  it('resolves "other" to the trimmed other text', () => {
    expect(resolveSingleSelection(OTHER_OPTION_ID, '  Custom Business Type  ')).toBe(
      'Custom Business Type',
    );
  });

  it('resolves "other" with blank text to an empty string', () => {
    expect(resolveSingleSelection(OTHER_OPTION_ID, '   ')).toBe('');
  });

  it('returns an empty string when nothing is selected', () => {
    expect(resolveSingleSelection('', '')).toBe('');
  });
});

describe('hydrateSelection', () => {
  it('hydrates known ids back into selectedIds with no other text', () => {
    const result = hydrateSelection(['alpha', 'gamma'], KNOWN_IDS);
    expect(result).toEqual({ selectedIds: ['alpha', 'gamma'], otherText: '' });
  });

  it('hydrates a persisted free-text value as "other" selected + otherText set', () => {
    const result = hydrateSelection(['alpha', 'Custom Type'], KNOWN_IDS);
    expect(result).toEqual({ selectedIds: ['alpha', OTHER_OPTION_ID], otherText: 'Custom Type' });
  });

  it('round-trips through resolveSelection → hydrateSelection for a mixed known + other selection', () => {
    const persisted = resolveSelection(['alpha', OTHER_OPTION_ID], 'Some Custom Value');
    const hydrated = hydrateSelection(persisted, KNOWN_IDS);
    expect(hydrated.selectedIds).toEqual(expect.arrayContaining(['alpha', OTHER_OPTION_ID]));
    expect(hydrated.selectedIds).toHaveLength(2);
    expect(hydrated.otherText).toBe('Some Custom Value');
  });

  it('round-trips a pure known-id selection with no other text', () => {
    const persisted = resolveSelection(['alpha', 'beta'], '');
    const hydrated = hydrateSelection(persisted, KNOWN_IDS);
    expect(hydrated).toEqual({ selectedIds: ['alpha', 'beta'], otherText: '' });
  });

  it('treats the literal free text "other" as an other-text value, not the other-option id', () => {
    // knownIds deliberately excludes OTHER_OPTION_ID itself, so a user who
    // once typed the word "other" into the free-text box round-trips back
    // into the text box rather than silently re-checking the Other option.
    const result = hydrateSelection(['other'], KNOWN_IDS);
    expect(result).toEqual({ selectedIds: [OTHER_OPTION_ID], otherText: 'other' });
  });

  it('only keeps the first unrecognized value as otherText, dropping subsequent unknowns', () => {
    const result = hydrateSelection(['Unknown A', 'Unknown B'], KNOWN_IDS);
    expect(result).toEqual({ selectedIds: [OTHER_OPTION_ID], otherText: 'Unknown A' });
  });

  it('returns empty selection for undefined persisted input', () => {
    expect(hydrateSelection(undefined, KNOWN_IDS)).toEqual({ selectedIds: [], otherText: '' });
  });

  it('returns empty selection for an empty persisted array', () => {
    expect(hydrateSelection([], KNOWN_IDS)).toEqual({ selectedIds: [], otherText: '' });
  });

  it('ignores an empty-string entry in the persisted array', () => {
    const result = hydrateSelection(['alpha', ''], KNOWN_IDS);
    expect(result).toEqual({ selectedIds: ['alpha'], otherText: '' });
  });
});

describe('hydrateSingleSelection', () => {
  it('hydrates a known id back into selectedId with no other text', () => {
    expect(hydrateSingleSelection('beta', KNOWN_IDS)).toEqual({
      selectedId: 'beta',
      otherText: '',
    });
  });

  it('hydrates an unrecognized legacy value as the "other" id + otherText', () => {
    expect(hydrateSingleSelection('Some Legacy Value', KNOWN_IDS)).toEqual({
      selectedId: OTHER_OPTION_ID,
      otherText: 'Some Legacy Value',
    });
  });

  it('round-trips through resolveSingleSelection → hydrateSingleSelection for an "other" value', () => {
    const persisted = resolveSingleSelection(OTHER_OPTION_ID, 'Custom Provider Type');
    const hydrated = hydrateSingleSelection(persisted, KNOWN_IDS);
    expect(hydrated).toEqual({ selectedId: OTHER_OPTION_ID, otherText: 'Custom Provider Type' });
  });

  it('round-trips through resolveSingleSelection → hydrateSingleSelection for a known id', () => {
    const persisted = resolveSingleSelection('alpha', '');
    const hydrated = hydrateSingleSelection(persisted, KNOWN_IDS);
    expect(hydrated).toEqual({ selectedId: 'alpha', otherText: '' });
  });

  it('returns empty selection for undefined persisted input', () => {
    expect(hydrateSingleSelection(undefined, KNOWN_IDS)).toEqual({
      selectedId: '',
      otherText: '',
    });
  });

  it('returns empty selection for an empty-string persisted input (never treats "" as other)', () => {
    expect(hydrateSingleSelection('', KNOWN_IDS)).toEqual({ selectedId: '', otherText: '' });
  });

  it('treats the literal persisted value "other" as free text, not the other-option id', () => {
    const result = hydrateSingleSelection('other', KNOWN_IDS);
    expect(result).toEqual({ selectedId: OTHER_OPTION_ID, otherText: 'other' });
  });
});
