/**
 * `adaptQuizOptions` is the one place the bulk v4.6 pipeline and the wizard's
 * single-question / regenerate actions agree on what an AI-generated question
 * looks like (founder ruling Q-13), so the invariants below hold for both.
 *
 * The shuffle is real `Math.random()`, so every assertion here is positional
 * only by way of the mapping it produces — never by a fixed index.
 */

import { describe, it, expect } from 'vitest';
import { adaptQuizOptions, type GeneratedQuizOption } from './options';

const OPTIONS: GeneratedQuizOption[] = [
  { text: '24h', isCorrect: false, distractorType: 'D3', explanation: 'Too short (D3).' },
  { text: '48h', isCorrect: false, distractorType: 'D1', explanation: 'Halves it (D1).' },
  { text: '72h', isCorrect: true, distractorType: null, explanation: 'Policy states 72 hours.' },
  { text: '96h', isCorrect: false, distractorType: 'D4', explanation: 'Overshoots (D4).' },
];

function rationaleByOptionText(options: GeneratedQuizOption[]): Record<string, string> {
  const adapted = adaptQuizOptions(options);
  return Object.fromEntries(
    Object.entries(adapted.explanation.incorrectOptions).map(([index, text]) => [
      adapted.options[Number(index)],
      text,
    ]),
  );
}

describe('adaptQuizOptions', () => {
  it('keeps every option and points `answer` at the one flagged correct', () => {
    for (let run = 0; run < 25; run++) {
      const adapted = adaptQuizOptions(OPTIONS);

      expect([...adapted.options].sort()).toEqual(['24h', '48h', '72h', '96h']);
      expect(adapted.options[adapted.answer]).toBe('72h');
    }
  });

  it('carries a rationale for the correct answer and for every wrong option', () => {
    const adapted = adaptQuizOptions(OPTIONS);

    expect(adapted.explanation.correctExplanation).toBe('Policy states 72 hours.');
    expect(Object.keys(adapted.explanation.incorrectOptions)).toHaveLength(3);
  });

  it('keys each wrong option rationale to that option after the shuffle', () => {
    for (let run = 0; run < 25; run++) {
      expect(rationaleByOptionText(OPTIONS)).toEqual({
        '24h': 'Too short (D3).',
        '48h': 'Halves it (D1).',
        '96h': 'Overshoots (D4).',
      });
    }
  });

  it('omits a wrong option whose rationale is missing or blank', () => {
    const adapted = adaptQuizOptions([
      { text: '24h', isCorrect: false, distractorType: 'D3' },
      { text: '48h', isCorrect: false, distractorType: 'D1', explanation: '   ' },
      { text: '72h', isCorrect: true, distractorType: null, explanation: 'Policy says 72h.' },
      { text: '96h', isCorrect: false, distractorType: 'D4', explanation: 'Overshoots (D4).' },
    ]);

    expect(Object.values(adapted.explanation.incorrectOptions)).toEqual(['Overshoots (D4).']);
    expect(adapted.options[Number(Object.keys(adapted.explanation.incorrectOptions)[0])]).toBe(
      '96h',
    );
  });

  it('degrades to the first option rather than throwing when nothing is flagged correct', () => {
    const adapted = adaptQuizOptions([
      { text: 'A', isCorrect: false, explanation: 'no' },
      { text: 'B', isCorrect: false, explanation: 'no' },
    ]);

    expect(adapted.answer).toBe(0);
    expect(adapted.explanation.correctExplanation).toBe('');
  });

  it('does not mutate the options it was given', () => {
    const input = OPTIONS.map((option) => ({ ...option }));
    const snapshot = JSON.stringify(input);

    adaptQuizOptions(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
