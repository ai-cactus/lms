import type {
  AmbiguousFlag,
  ArticleMetaV46,
  ArticleSectionV46,
  InvalidFlag,
  JudgeV46,
  LearningObjectiveV46,
  NormV46,
  QuizQuestionV46,
  QuizV46,
  SlideV46,
  SlidesV46,
  SnippetV46,
} from '@/lib/prompt-types-v4.6';

/**
 * Raw v4.6 artifacts produced for one wizard module, in course order.
 */
export interface ModuleArtifacts {
  moduleIndex: number;
  moduleTitle: string;
  articleMeta: ArticleMetaV46 | null;
  articleMarkdown: string;
  slidesJson: SlidesV46 | null;
  quizJson: QuizV46 | null;
  judgeJson: JudgeV46 | null;
}

/** Every merged record keeps the module it came from. */
type Tagged<T> = T & { moduleIndex: number };

export interface MergedCourseArtifacts {
  rawArticleMeta?: Record<string, unknown>;
  rawArticleMarkdown: string;
  rawSlidesJson?: Record<string, unknown>;
  rawQuizJson?: Record<string, unknown>;
  rawJudgeJson?: Record<string, unknown>;
}

function tagAll<T>(items: T[] | undefined, moduleIndex: number): Tagged<T>[] {
  return (items ?? []).map((item) => ({ ...item, moduleIndex }));
}

/** Prefixes free-text notes with their module so attribution survives the merge. */
function attribute(notes: string[] | undefined, moduleTitle: string): string[] {
  return (notes ?? []).map((note) => `${moduleTitle}: ${note}`);
}

/**
 * Folds the per-module v4.6 artifacts into the course-level `raw*` columns.
 *
 * The schema stores these artifacts on the Course, so a multi-module course
 * merges rather than picking a winner: nothing generated is thrown away, and
 * every merged section / slide / question / flag carries a `moduleIndex` so its
 * module can still be recovered. Section ids are NOT namespaced — they are only
 * unique within a module, so a reader must key on `(moduleIndex, sectionId)`.
 *
 * An artifact that no module produced stays `undefined`, matching the
 * single-document pipeline so the publish-review gate keeps behaving the same.
 */
export function mergeModuleArtifacts(
  modules: ModuleArtifacts[],
  courseTitle: string,
): MergedCourseArtifacts {
  const ordered = [...modules].sort((a, b) => a.moduleIndex - b.moduleIndex);

  const rawArticleMarkdown = ordered
    .filter((m) => m.articleMarkdown)
    .map((m) => `# ${m.moduleTitle}\n\n${m.articleMarkdown.trim()}`)
    .join('\n\n---\n\n');

  const metaModules = ordered.filter((m) => m.articleMeta);
  let rawArticleMeta: Record<string, unknown> | undefined;
  if (metaModules.length > 0) {
    const sections: Tagged<ArticleSectionV46>[] = [];
    const learningObjectives: Tagged<LearningObjectiveV46>[] = [];
    const snippets: Tagged<SnippetV46>[] = [];
    const norms: Tagged<NormV46>[] = [];
    const gaps: string[] = [];
    const reviewerNotes: string[] = [];

    for (const mod of metaModules) {
      const meta = mod.articleMeta as ArticleMetaV46;
      sections.push(...tagAll(meta.sections, mod.moduleIndex));
      learningObjectives.push(...tagAll(meta.learningObjectives, mod.moduleIndex));
      snippets.push(...tagAll(meta.snippets, mod.moduleIndex));
      norms.push(...tagAll(meta.norms, mod.moduleIndex));
      gaps.push(...attribute(meta.meta?.gaps, mod.moduleTitle));
      reviewerNotes.push(...attribute(meta.meta?.reviewerNotes, mod.moduleTitle));
    }

    const firstMeta = (metaModules[0].articleMeta as ArticleMetaV46).meta;

    rawArticleMeta = {
      meta: {
        promptVersion: firstMeta?.promptVersion,
        // A single module short on source material degrades the whole course,
        // so the gate must see `needs_sources` at course level too.
        status: metaModules.some((m) => m.articleMeta?.meta?.status === 'needs_sources')
          ? 'needs_sources'
          : 'ok',
        title: courseTitle,
        sourceLabel: ordered.map((m) => m.moduleTitle).join(', '),
        sectionCount: sections.length,
        objectiveCount: learningObjectives.length,
        gaps,
        reviewerNotes,
      },
      learningObjectives,
      sections,
      snippets,
      norms,
      modules: ordered.map((m) => ({
        moduleIndex: m.moduleIndex,
        title: m.moduleTitle,
        meta: m.articleMeta?.meta,
      })),
    };
  }

  const slideModules = ordered.filter((m) => m.slidesJson);
  let rawSlidesJson: Record<string, unknown> | undefined;
  if (slideModules.length > 0) {
    const slides: Tagged<SlideV46>[] = [];
    const gaps: string[] = [];
    const reviewerNotes: string[] = [];
    let desiredSlideCount = 0;

    for (const mod of slideModules) {
      const slidesJson = mod.slidesJson as SlidesV46;
      slides.push(...tagAll(slidesJson.slides, mod.moduleIndex));
      desiredSlideCount += slidesJson.meta?.desiredSlideCount ?? 0;
      gaps.push(...attribute(slidesJson.meta?.gaps, mod.moduleTitle));
      reviewerNotes.push(...attribute(slidesJson.meta?.reviewerNotes, mod.moduleTitle));
    }

    const firstMeta = (slideModules[0].slidesJson as SlidesV46).meta;

    rawSlidesJson = {
      meta: {
        promptVersion: firstMeta?.promptVersion,
        basedOnArticleMetaVersion: firstMeta?.basedOnArticleMetaVersion,
        desiredSlideCount,
        totalSlides: slides.length,
        gaps,
        reviewerNotes,
      },
      slides,
    };
  }

  const quizModules = ordered.filter((m) => m.quizJson);
  let rawQuizJson: Record<string, unknown> | undefined;
  if (quizModules.length > 0) {
    const questions: Tagged<QuizQuestionV46>[] = [];
    const coverageNotes: string[] = [];
    const gaps: string[] = [];
    const reviewerNotes: string[] = [];
    let requestedQuestionCount = 0;

    for (const mod of quizModules) {
      const quizJson = mod.quizJson as QuizV46;
      questions.push(...tagAll(quizJson.questions, mod.moduleIndex));
      requestedQuestionCount += quizJson.meta?.requestedQuestionCount ?? 0;
      if (quizJson.meta?.coverageNote) {
        coverageNotes.push(`${mod.moduleTitle}: ${quizJson.meta.coverageNote}`);
      }
      gaps.push(...attribute(quizJson.meta?.gaps, mod.moduleTitle));
      reviewerNotes.push(...attribute(quizJson.meta?.reviewerNotes, mod.moduleTitle));
    }

    const firstMeta = (quizModules[0].quizJson as QuizV46).meta;

    rawQuizJson = {
      meta: {
        promptVersion: firstMeta?.promptVersion,
        basedOnArticleMetaVersion: firstMeta?.basedOnArticleMetaVersion,
        requestedQuestionCount,
        quizDifficulty: firstMeta?.quizDifficulty,
        totalQuestions: questions.length,
        coverageNote: coverageNotes.join(' '),
        gaps,
        reviewerNotes,
      },
      questions,
    };
  }

  const judgeModules = ordered.filter((m) => m.judgeJson);
  let rawJudgeJson: Record<string, unknown> | undefined;
  if (judgeModules.length > 0) {
    const ambiguous: Tagged<AmbiguousFlag>[] = [];
    const invalid: Tagged<InvalidFlag>[] = [];
    const notes: string[] = [];
    let totalQuestions = 0;

    for (const mod of judgeModules) {
      const judgeJson = mod.judgeJson as JudgeV46;
      ambiguous.push(...tagAll(judgeJson.ambiguous, mod.moduleIndex));
      invalid.push(...tagAll(judgeJson.invalid, mod.moduleIndex));
      totalQuestions += judgeJson.meta?.totalQuestions ?? 0;
      notes.push(...attribute(judgeJson.meta?.notes, mod.moduleTitle));
    }

    rawJudgeJson = {
      meta: {
        promptVersion: (judgeModules[0].judgeJson as JudgeV46).meta?.promptVersion,
        totalQuestions,
        ambiguousCount: ambiguous.length,
        invalidCount: invalid.length,
        notes,
      },
      ambiguous,
      invalid,
    };
  }

  return { rawArticleMeta, rawArticleMarkdown, rawSlidesJson, rawQuizJson, rawJudgeJson };
}
