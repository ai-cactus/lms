import { describe, it, expect } from 'vitest';
import { parseQuizCsv, parseQuizJson, parseQuizFile } from './quiz-import';
import { QuizImportError } from './types';

const CSV = `question,option_a,option_b,option_c,option_d,correct_answer,explanation
What does PHI stand for?,Protected Health Information,Private Hospital Index,Patient Health Insurance,,A,PHI = Protected Health Information.
Which is a safeguard?,Marketing,Administrative safeguards,,,Administrative safeguards,`;

describe('parseQuizCsv', () => {
  it('parses rows, drops empty options, resolves letter and text correctAnswer to option text', () => {
    const quiz = parseQuizCsv(CSV);
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]).toMatchObject({
      text: 'What does PHI stand for?',
      options: [
        'Protected Health Information',
        'Private Hospital Index',
        'Patient Health Insurance',
      ],
      correctAnswer: 'Protected Health Information', // 'A' → option text
      explanation: 'PHI = Protected Health Information.',
      order: 0,
    });
    expect(quiz.questions[1].correctAnswer).toBe('Administrative safeguards'); // text → text
    expect(quiz.questions[1].explanation).toBeUndefined();
  });

  it('throws QuizImportError when correct_answer matches no option', () => {
    const bad = `question,option_a,option_b,correct_answer\nQ1,Yes,No,Maybe`;
    expect(() => parseQuizCsv(bad)).toThrow(QuizImportError);
  });

  it('throws when a question has fewer than 2 options', () => {
    const bad = `question,option_a,option_b,correct_answer\nQ1,OnlyOne,,A`;
    expect(() => parseQuizCsv(bad)).toThrow(QuizImportError);
  });

  it('throws QuizImportError when correct_answer letter is out of range for available options', () => {
    // only option_a and option_b provided, C has no matching index
    const bad = `question,option_a,option_b,correct_answer\nQ1,Yes,No,C`;
    expect(() => parseQuizCsv(bad)).toThrow(QuizImportError);
  });

  it('parses a question with embedded comma inside a double-quoted field', () => {
    const csv = `question,option_a,option_b,correct_answer\n"What is 1,000?","A thousand","A million",A`;
    const quiz = parseQuizCsv(csv);
    expect(quiz.questions[0].text).toBe('What is 1,000?');
    expect(quiz.questions[0].options).toEqual(['A thousand', 'A million']);
    expect(quiz.questions[0].correctAnswer).toBe('A thousand');
  });

  it('throws QuizImportError for a header-only CSV (no data rows)', () => {
    const headerOnly = `question,option_a,option_b,correct_answer`;
    expect(() => parseQuizCsv(headerOnly)).toThrow(QuizImportError);
  });
});

describe('parseQuizJson', () => {
  it('parses questions and carries passingScore/allowedAttempts', () => {
    const quiz = parseQuizJson(
      JSON.stringify({
        passingScore: 80,
        allowedAttempts: 2,
        questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 'b', explanation: 'because' }],
      }),
    );
    expect(quiz.passingScore).toBe(80);
    expect(quiz.allowedAttempts).toBe(2);
    expect(quiz.questions[0]).toMatchObject({ correctAnswer: 'b', order: 0 });
  });
  it('accepts a 0-based numeric correctAnswer index', () => {
    const quiz = parseQuizJson(
      JSON.stringify({ questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 1 }] }),
    );
    expect(quiz.questions[0].correctAnswer).toBe('b');
  });

  it('resolves a letter-string correctAnswer ("B") to the matching option text', () => {
    const quiz = parseQuizJson(
      JSON.stringify({
        questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 'B' }],
      }),
    );
    expect(quiz.questions[0].correctAnswer).toBe('b');
  });

  it('throws QuizImportError when numeric correctAnswer is out of range', () => {
    const bad = JSON.stringify({
      questions: [{ text: 'Q', options: ['a', 'b'], correctAnswer: 5 }],
    });
    expect(() => parseQuizJson(bad)).toThrow(QuizImportError);
  });

  it('throws QuizImportError when a question has more than 4 options', () => {
    const bad = JSON.stringify({
      questions: [{ text: 'Q', options: ['a', 'b', 'c', 'd', 'e'], correctAnswer: 0 }],
    });
    expect(() => parseQuizJson(bad)).toThrow(QuizImportError);
  });
});

describe('parseQuizFile', () => {
  it('dispatches by filename extension', () => {
    expect(
      parseQuizFile(
        'q.json',
        '{"questions":[{"text":"Q","options":["a","b"],"correctAnswer":"a"}]}',
      ).questions,
    ).toHaveLength(1);
    expect(
      parseQuizFile('q.csv', 'question,option_a,option_b,correct_answer\nQ,a,b,A').questions,
    ).toHaveLength(1);
  });
  it('throws on unsupported extension', () => {
    expect(() => parseQuizFile('q.txt', 'x')).toThrow();
  });
});

import { SAMPLE_QUIZ_CSV, SAMPLE_QUIZ_JSON } from './samples';
describe('samples are valid', () => {
  it('parse without throwing', () => {
    expect(parseQuizFile('s.csv', SAMPLE_QUIZ_CSV).questions.length).toBeGreaterThan(0);
    expect(parseQuizFile('s.json', SAMPLE_QUIZ_JSON).questions.length).toBeGreaterThan(0);
  });
});
