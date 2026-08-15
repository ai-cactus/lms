import { describe, expect, it } from 'vitest';

import { WIZARD_FORM_DATA } from '@/components/dashboard/courses/steps/wizardTestData';
import { buildModuleGenerationFormData, distributeQuestionCount } from './module-generation';

describe('distributeQuestionCount', () => {
  it('splits the total so the shares always sum back to it', () => {
    // 15 questions over 2 modules: ceil(15/2) = 8, and the last absorbs the rest.
    expect(distributeQuestionCount(15, 2)).toEqual([8, 7]);
    expect(distributeQuestionCount(15, 4)).toEqual([4, 4, 4, 3]);
    expect(distributeQuestionCount(12, 3)).toEqual([4, 4, 4]);
  });

  it('gives a single module the whole total', () => {
    expect(distributeQuestionCount(15, 1)).toEqual([15]);
  });

  it('never emits a negative share when the total is smaller than the module count', () => {
    const shares = distributeQuestionCount(2, 4);
    expect(shares).toEqual([1, 1, 1, 0]);
    expect(shares.every((share) => share >= 0)).toBe(true);
  });

  it('treats a missing or invalid total as zero', () => {
    expect(distributeQuestionCount(NaN, 2)).toEqual([0, 0]);
    expect(distributeQuestionCount(-5, 2)).toEqual([0, 0]);
  });

  it('returns nothing when there are no modules', () => {
    expect(distributeQuestionCount(10, 0)).toEqual([]);
  });
});

describe('buildModuleGenerationFormData', () => {
  const courseData = { ...WIZARD_FORM_DATA, quizQuestionCount: '15' };

  it('carries the course-level settings through and overrides only the per-module fields', () => {
    const formData = buildModuleGenerationFormData(
      courseData,
      {
        moduleIndex: 1,
        documentId: 'doc-2',
        title: 'Hand Hygiene',
        objective: 'Wash your hands correctly',
      },
      7,
    );

    expect(formData.get('documentId')).toBe('doc-2');

    const sent = JSON.parse(formData.get('data') as string);
    // Per module.
    expect(sent.title).toBe('Hand Hygiene');
    expect(sent.description).toBe('Wash your hands correctly');
    expect(sent.quizQuestionCount).toBe('7');
    // Course-level settings are shared by every module.
    expect(sent.quizDifficulty).toBe(courseData.quizDifficulty);
    expect(sent.quizQuestionType).toBe(courseData.quizQuestionType);
    expect(sent.quizPassMark).toBe(courseData.quizPassMark);
    expect(sent.notesCount).toBe(courseData.notesCount);
    expect(sent.categoryId).toBe(courseData.categoryId);
  });

  it('falls back to the course title and description when the module has none', () => {
    const formData = buildModuleGenerationFormData(
      courseData,
      { moduleIndex: 0, documentId: 'doc-1', title: '', objective: null },
      8,
    );

    const sent = JSON.parse(formData.get('data') as string);
    expect(sent.title).toBe(courseData.title);
    expect(sent.description).toBe(courseData.description);
  });
});
