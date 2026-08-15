import { describe, expect, it } from 'vitest';

import { mergeModuleArtifacts, type ModuleArtifacts } from './v46-aggregate';

/**
 * The course-level `raw*` columns hold one course, but a multi-module course
 * generates one set of artifacts per module — so the merge must lose nothing
 * and must keep every record attributable to its module.
 */
function moduleArtifacts(moduleIndex: number, overrides: Partial<ModuleArtifacts> = {}) {
  return {
    moduleIndex,
    moduleTitle: `Module ${moduleIndex}`,
    articleMeta: {
      meta: {
        promptVersion: 'v4.6',
        status: 'ok',
        title: `Module ${moduleIndex}`,
        sourceLabel: 'doc',
        sectionCount: 1,
        objectiveCount: 1,
        gaps: [],
        reviewerNotes: [],
      },
      learningObjectives: [{ id: 'LO1', text: 'objective', primarySections: ['S1'] }],
      sections: [
        {
          sectionId: 'S1',
          title: 'Section one',
          anchorHint: '',
          keyPoints: [],
          normIds: [],
          snippetIds: [],
        },
      ],
      snippets: [],
      norms: [],
    },
    articleMarkdown: `## Section one\n\nBody ${moduleIndex}`,
    slidesJson: {
      meta: {
        promptVersion: 'v4.6',
        basedOnArticleMetaVersion: 'v4.6',
        desiredSlideCount: 5,
        totalSlides: 1,
        gaps: [],
        reviewerNotes: [],
      },
      slides: [{ slideId: 'sl1', title: 'Slide', bullets: [], sourceSections: ['S1'] }],
    },
    quizJson: {
      meta: {
        promptVersion: 'v4.6',
        basedOnArticleMetaVersion: 'v4.6',
        requestedQuestionCount: 8,
        quizDifficulty: 'medium',
        totalQuestions: 1,
        coverageNote: 'no gaps',
        gaps: [],
        reviewerNotes: [],
      },
      questions: [{ id: 'Q1', sectionId: 'S1', question: 'Q?' }],
    },
    judgeJson: {
      meta: {
        promptVersion: 'v4.6',
        totalQuestions: 1,
        ambiguousCount: 0,
        invalidCount: 1,
        notes: [],
      },
      ambiguous: [],
      invalid: [{ questionId: 'Q1', type: 'unclear', why: 'why', suggestedFix: 'fix' }],
    },
    ...overrides,
  } as unknown as ModuleArtifacts;
}

describe('mergeModuleArtifacts', () => {
  it('concatenates every module’s records and tags each with its module', () => {
    const merged = mergeModuleArtifacts([moduleArtifacts(0), moduleArtifacts(1)], 'Whole Course');

    const meta = merged.rawArticleMeta as Record<string, never[]> & {
      meta: Record<string, string>;
    };
    expect(meta.sections.map((s: { moduleIndex: number }) => s.moduleIndex)).toEqual([0, 1]);
    expect(meta.learningObjectives).toHaveLength(2);
    expect(meta.meta.title).toBe('Whole Course');
    expect(meta.meta.status).toBe('ok');

    const slides = merged.rawSlidesJson as { slides: { moduleIndex: number }[] };
    expect(slides.slides.map((s) => s.moduleIndex)).toEqual([0, 1]);

    const quiz = merged.rawQuizJson as {
      meta: { requestedQuestionCount: number; coverageNote: string };
      questions: { moduleIndex: number }[];
    };
    // The requested counts are per-module shares — the course asked for their sum.
    expect(quiz.meta.requestedQuestionCount).toBe(16);
    expect(quiz.questions.map((q) => q.moduleIndex)).toEqual([0, 1]);
    expect(quiz.meta.coverageNote).toBe('Module 0: no gaps Module 1: no gaps');

    const judge = merged.rawJudgeJson as { meta: { invalidCount: number } };
    expect(judge.meta.invalidCount).toBe(2);
  });

  it('keeps each module’s markdown behind its own heading, in module order', () => {
    const merged = mergeModuleArtifacts([moduleArtifacts(1), moduleArtifacts(0)], 'Whole Course');

    expect(merged.rawArticleMarkdown).toBe(
      '# Module 0\n\n## Section one\n\nBody 0\n\n---\n\n# Module 1\n\n## Section one\n\nBody 1',
    );
  });

  it('degrades the whole course when a single module lacked source material', () => {
    const short = moduleArtifacts(1);
    (short.articleMeta as { meta: { status: string; gaps: string[] } }).meta.status =
      'needs_sources';
    (short.articleMeta as { meta: { status: string; gaps: string[] } }).meta.gaps = ['too thin'];

    const merged = mergeModuleArtifacts([moduleArtifacts(0), short], 'Whole Course');
    const meta = merged.rawArticleMeta as { meta: { status: string; gaps: string[] } };

    expect(meta.meta.status).toBe('needs_sources');
    // Free-text notes stay attributable to the module that produced them.
    expect(meta.meta.gaps).toEqual(['Module 1: too thin']);
  });

  it('leaves an artifact undefined when no module produced one', () => {
    const merged = mergeModuleArtifacts(
      [moduleArtifacts(0, { slidesJson: null }), moduleArtifacts(1, { slidesJson: null })],
      'Whole Course',
    );

    expect(merged.rawSlidesJson).toBeUndefined();
    expect(merged.rawQuizJson).toBeDefined();
  });
});
