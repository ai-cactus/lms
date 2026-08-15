'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  startModuleGenerationJobs,
  checkCourseGenerationJobV46,
  type GeneratedCourseV46,
} from '@/app/actions/course-ai-v4.6';
import { useMultiJobStatus, type MultiJobCreateResult } from '@/hooks/use-multi-job-status';
import {
  distributeQuestionCount,
  type ModuleGenerationRequest,
} from '@/lib/course/module-generation';
import { mergeModuleArtifacts, type ModuleArtifacts } from '@/lib/course/v46-aggregate';
import {
  clearPendingGeneration,
  writePendingGeneration,
  type PendingGenerationJob,
} from '@/lib/course/pending-generation';

import WizardReviewArticle from '@/components/dashboard/courses/review/WizardReviewArticle';
import WizardReviewSlides from '@/components/dashboard/courses/review/WizardReviewSlides';
import { formatReviewDate } from '@/components/dashboard/courses/review/reviewContent';
import { Button } from '@/components/ui/button';
import { getCategories } from '@/app/actions/categories';
import { logger } from '@/lib/logger';
import { Check, Circle, Loader2, TriangleAlert } from 'lucide-react';

import {
  CourseWizardData,
  GeneratedCourse,
  GeneratedCourseModule,
  RenderableModule,
} from '@/types/course';

interface GenerationControllerProps {
  data: CourseWizardData;
  initialContent?: GeneratedCourse | null;
  onComplete: (content: GeneratedCourse) => void;
  /** Jobs from an interrupted run, resumed instead of generating again. */
  pendingJobs?: PendingGenerationJob[] | null;
  /** Lets the wizard hide its nav row while the modules are generating. */
  onGeneratingChange?: (isGenerating: boolean) => void;
}

// Poll cadence for the generation job status.
const POLL_INTERVAL_MS = 3000;

// Client-side backstop: stop polling after this long even if the server never
// reaches a terminal state, so the UI can never spin forever (THER-002). Kept
// slightly above the server wall-clock timeout so the server normally settles
// the job first; this only catches a fully dead worker. Overridable via env.
const MAX_POLL_MS = Number(process.env.NEXT_PUBLIC_V46_GENERATION_TIMEOUT_MS) || 11 * 60 * 1000;

// Single user-safe failure message — internal backend detail never reaches the
// client, so the UI always shows this generic, actionable copy (THER-013).
const GENERATION_ERROR_MESSAGE =
  "We couldn't generate a course from this document — it may be too short or lack detail. Please try a more detailed document, or try again.";

/**
 * The staged checklist on the generation screen. The first three items track
 * the modules' jobs (created → started → completed); the last covers folding
 * the finished modules into one course, which happens on the client.
 */
const GENERATION_STAGES = [
  'Analyzing policy and procedure',
  'Extract course input data',
  'Create course content and quiz',
  'Finalize all modules',
];

/**
 * Converts v4.6 article Markdown into HTML for backward-compatible rendering.
 * Handles ## headings, ### subheadings, paragraphs, and bullet lists.
 */
function articleMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  return (
    markdown
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('### ')) return `<h4>${trimmed.slice(4)}</h4>`;
        if (trimmed.startsWith('## ')) return `<h3>${trimmed.slice(3)}</h3>`;
        if (trimmed.startsWith('# ')) return `<h2>${trimmed.slice(2)}</h2>`;
        if (trimmed.startsWith('- ') || trimmed.startsWith('* '))
          return `<li>${trimmed.slice(2)}</li>`;
        if (trimmed.length === 0) return '';
        return `<p>${trimmed}</p>`;
      })
      .join('\n')
      // Parse bold markdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Wrap consecutive <li> tags in <ul>
      .replace(/(<li>[\s\S]*?<\/li>)(\n?)(?!<li>)/g, (match) => `<ul>${match}</ul>`)
      .replace(/<\/ul>\n?<ul>/g, '\n')
  );
}

interface RichSlide {
  title?: string;
  bullets?: string[];
  slideType?: string;
  layoutHint?: string;
  coreConcept?: string;
  actionSteps?: string[];
  criticalDetails?: string[];
  scenario?: { situation: string; correctAction: string; wrongAction?: string; rationale: string };
  terminology?: { term: string; definition: string }[];
  processSequence?: { stepNumber: number; action: string; rationale: string }[];
  sourceSections?: string[];
}

/**
 * Converts v4.6 slides into type-differentiated HTML for the Slide view.
 * Generates structurally different HTML per slide type (TELL/SHOW/DO)
 * with CSS classes for visual styling.
 */
function slidesV46ToHtml(slides: RichSlide[]): string {
  if (!slides || slides.length === 0) return '';

  return slides
    .map((slide) => {
      const type = slide.slideType || 'TELL';
      const typeClass = `slide-type-${type.toLowerCase()}`;

      let html = `<div class="rich-slide ${typeClass}">`;

      const typeLabel = type === 'TELL' ? 'CONCEPT' : type === 'SHOW' ? 'SCENARIO' : 'ACTION';
      html += `<span class="slide-type-badge slide-type-badge-${type.toLowerCase()}">${typeLabel}</span>`;

      if (slide.title) {
        html += `<h3 class="slide-heading">${slide.title}</h3>`;
      }

      // Core Concept (all types)
      if (slide.coreConcept) {
        html += `<div class="slide-core-concept"><p>${slide.coreConcept}</p></div>`;
      }

      // Type-specific content
      if (type === 'TELL') {
        if (slide.bullets && slide.bullets.length > 0) {
          html += '<ul class="slide-key-points">';
          html += slide.bullets.map((b: string) => `<li>${b}</li>`).join('');
          html += '</ul>';
        }
        if (slide.terminology && slide.terminology.length > 0) {
          html += '<div class="slide-terms-box">';
          html += '<h4 class="slide-box-title">Key Terms</h4>';
          slide.terminology.forEach((t) => {
            html += `<div class="slide-term-item"><strong>${t.term}</strong>: ${t.definition}</div>`;
          });
          html += '</div>';
        }
        if (slide.criticalDetails && slide.criticalDetails.length > 0) {
          html += '<div class="slide-details-box">';
          html += '<h4 class="slide-box-title">Critical Details</h4>';
          html += '<ul>';
          html += slide.criticalDetails.map((d: string) => `<li>${d}</li>`).join('');
          html += '</ul></div>';
        }
      }

      if (type === 'SHOW') {
        if (slide.scenario) {
          html += '<div class="slide-scenario">';
          html += `<div class="scenario-label">Workplace Scenario</div>`;
          html += `<div class="scenario-situation"><span class="scenario-tag">Situation</span> ${slide.scenario.situation}</div>`;
          html += `<div class="scenario-correct"><span class="scenario-tag">Correct Action</span> ${slide.scenario.correctAction}</div>`;
          if (slide.scenario.wrongAction) {
            html += `<div class="scenario-wrong"><span class="scenario-tag">Common Mistake</span> ${slide.scenario.wrongAction}</div>`;
          }
          html += `<div class="scenario-rationale"><span class="scenario-tag">Why</span> ${slide.scenario.rationale}</div>`;
          html += '</div>';
        }
        if (slide.bullets && slide.bullets.length > 0) {
          html += '<ul class="slide-key-points">';
          html += slide.bullets.map((b: string) => `<li>${b}</li>`).join('');
          html += '</ul>';
        }
      }

      if (type === 'DO') {
        if (slide.actionSteps && slide.actionSteps.length > 0) {
          html += '<ol class="slide-action-steps">';
          html += slide.actionSteps.map((s: string) => `<li>${s}</li>`).join('');
          html += '</ol>';
        }
        if (slide.processSequence && slide.processSequence.length > 0) {
          html += '<div class="slide-process-flow">';
          slide.processSequence.forEach((s) => {
            html += `<div class="process-step"><span class="step-number">Step ${s.stepNumber}</span><span class="step-action">${s.action}</span><span class="step-why">${s.rationale}</span></div>`;
          });
          html += '</div>';
        }
        if (slide.criticalDetails && slide.criticalDetails.length > 0) {
          html += '<div class="slide-details-box">';
          html += '<h4 class="slide-box-title">What You Need</h4>';
          html += '<ul>';
          html += slide.criticalDetails.map((d: string) => `<li>${d}</li>`).join('');
          html += '</ul></div>';
        }
        if (!slide.actionSteps?.length && !slide.processSequence?.length && slide.bullets?.length) {
          html += '<ul class="slide-checklist">';
          html += slide.bullets.map((b: string) => `<li>${b}</li>`).join('');
          html += '</ul>';
        }
      }

      html += '</div>'; // close rich-slide
      return html;
    })
    .join('');
}

/**
 * Splits article markdown into sections by ## headings.
 * Returns an array of { title, content } for mapping to modules.
 */
function splitMarkdownSections(markdown: string): { title: string; content: string }[] {
  if (!markdown) return [];

  const sections: { title: string; content: string }[] = [];
  const lines = markdown.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      if (currentTitle || currentLines.length > 0) {
        sections.push({
          title: currentTitle || 'Untitled Section',
          content: currentLines.join('\n'),
        });
      }
      currentTitle = trimmed.replace(/^#{1,2}\s+/, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentTitle || currentLines.length > 0) {
    sections.push({
      title: currentTitle || 'Untitled Section',
      content: currentLines.join('\n'),
    });
  }

  return sections;
}

/**
 * Adapts v4.6 output into the module format expected by existing UI components
 * and CourseWizard data flow: { title, content, slideContent, duration, ... }
 */
const adaptModulesForRenderingV46 = (
  articleMeta:
    | { sections: { title: string; sectionId: string; keyPoints?: string[] }[] }
    | null
    | undefined,
  articleMarkdown: string,
  slidesJson: { slides: RichSlide[] } | null | undefined,
  estimatedDurationMinutes?: number,
): RenderableModule[] => {
  const markdownSections = splitMarkdownSections(articleMarkdown);
  const metaSections = articleMeta?.sections || [];
  const slides = slidesJson?.slides || [];

  return metaSections.map(
    (section: { title: string; sectionId: string; keyPoints?: string[] }, idx: number) => {
      const mdSection =
        markdownSections.find(
          (s) =>
            s.title.toLowerCase().includes(section.title.toLowerCase()) ||
            section.title.toLowerCase().includes(s.title.toLowerCase()),
        ) || markdownSections[idx];

      const sectionSlides = slides.filter((sl: RichSlide) =>
        sl.sourceSections?.includes(section.sectionId),
      );

      // If no slides match by sourceSections, distribute evenly
      const fallbackSlides =
        sectionSlides.length > 0
          ? sectionSlides
          : slides.slice(
              Math.floor((idx * slides.length) / metaSections.length),
              Math.floor(((idx + 1) * slides.length) / metaSections.length),
            );

      const sectionDuration = Math.round((estimatedDurationMinutes || 60) / metaSections.length);

      return {
        id: `m-${idx}`,
        title: section.title,
        content: mdSection ? articleMarkdownToHtml(mdSection.content) : '',
        slideContent: slidesV46ToHtml(fallbackSlides),
        duration: `${sectionDuration} min`,
        order: idx,
        sectionId: section.sectionId,
        keyPoints: section.keyPoints,
      };
    },
  );
};

import { QuizQuestion } from '@/types/quiz';

interface RawAIQuizQuestion {
  question: string;
  options: { text: string; isCorrect: boolean; explanation?: string }[];
  skill?: string;
  templateId?: string;
  difficulty?: string;
  evidence?: { sectionId: string };
  sectionId?: string;
  stimulus?: string;
}

/**
 * Fisher-Yates shuffle for an array. Returns a NEW shuffled array.
 * Used to randomise quiz option order so the correct answer is not always option A.
 */
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Adapts v4.6 quiz questions into the format expected by Step8QuizReview
 * and createFullCourse: { question, options: string[], answer: number, ... }
 *
 * Options are SHUFFLED so the correct answer is randomly distributed across
 * positions A–D, preventing the LLM bias of always placing the correct answer first.
 */
const adaptQuizForRenderingV46 = (
  quizJson: { questions: RawAIQuizQuestion[] } | null | undefined,
): QuizQuestion[] => {
  if (!quizJson?.questions) return [];
  return quizJson.questions.map((q) => {
    // Tag each raw option with its original index so we can track the correct one after shuffle
    type TaggedOption = {
      text: string;
      isCorrect: boolean;
      explanation?: string;
      originalIndex: number;
    };
    const taggedOptions: TaggedOption[] = (
      q.options as { text: string; isCorrect: boolean; explanation?: string }[]
    ).map((o, idx) => ({ ...o, originalIndex: idx }));

    // Shuffle so the correct answer lands at a random position
    const shuffled = shuffleArray(taggedOptions);

    // The new correct-answer index is wherever isCorrect ended up after the shuffle
    const newCorrectIdx = shuffled.findIndex((o) => o.isCorrect);

    const correctOption = shuffled.find((o) => o.isCorrect);

    // Build incorrectOptions keyed by NEW (shuffled) index so explanations stay in sync
    const incorrectOptions: Record<string, string> = {};
    shuffled.forEach((o, idx) => {
      if (!o.isCorrect) {
        incorrectOptions[String(idx)] = o.explanation || '';
      }
    });

    return {
      // Legacy-compatible fields expected by Step8QuizReview
      question: q.question,
      options: shuffled.map((o) => o.text),
      answer: newCorrectIdx >= 0 ? newCorrectIdx : 0,
      type: 'multiple_choice',
      // v4.6 rich data
      archetype: q.skill || q.templateId,
      difficulty: q.difficulty,
      explanation: {
        correctExplanation: correctOption?.explanation || '',
        incorrectOptions,
      },
      evidence: q.evidence
        ? {
            moduleSectionId: q.evidence.sectionId || '',
            moduleSectionHeading: q.sectionId || '',
            sourceAnchors: [],
          }
        : undefined,
      moduleTitle: q.sectionId,
      stimulus: q.stimulus,
      templateId: q.templateId,
    };
  });
};

export default function GenerationController({
  data,
  initialContent,
  onComplete,
  pendingJobs,
  onGeneratingChange,
}: GenerationControllerProps) {
  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(
    initialContent || null,
  );

  const [viewMode, setViewMode] = useState<'slides' | 'article'>('article');
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [editedModules, setEditedModules] = useState<RenderableModule[]>(
    initialContent?.modules || [],
  );
  // Source text arrives per module and is merged into one string on the course,
  // so the review screen keeps the per-module split it needs for the Sources card.
  const [sourceTextByModule, setSourceTextByModule] = useState<Record<number, string>>({});
  const [categoryName, setCategoryName] = useState('');
  // Nothing is persisted yet, so "Last update" is the moment the review opened.
  const [lastUpdatedLabel] = useState(() => formatReviewDate(new Date()));

  const hasInitialContent = !!initialContent;
  const wizardModules = data.modules;
  const { categoryId } = data;

  // The wizard carries only the category id, so the chip's display name is
  // resolved here rather than duplicated into the draft.
  useEffect(() => {
    let cancelled = false;

    async function loadCategoryName() {
      try {
        const categories = await getCategories();
        if (cancelled) return;
        setCategoryName(categories.find((category) => category.id === categoryId)?.name ?? '');
      } catch (err) {
        logger.error({ msg: '[course] Failed to load the course category name', err });
      }
    }

    loadCategoryName();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // Folds every module's completed job into one ordered course: lessons and
  // quiz questions are concatenated in wizard order and tagged with the module
  // they came from, and the raw v4.6 artifacts are merged for persistence.
  const buildCourseFromResults = useCallback(
    (results: { moduleIndex: number; result: GeneratedCourseV46 }[]) => {
      // `data.duration` is the whole course; each module's sections share it.
      const perModuleDuration = Math.max(
        Math.round((parseInt(data.duration) || 60) / Math.max(results.length, 1)),
        1,
      );

      const lessons: RenderableModule[] = [];
      const quiz: QuizQuestion[] = [];
      const courseModules: GeneratedCourseModule[] = [];
      const artifacts: ModuleArtifacts[] = [];
      const warnings: string[] = [];

      for (const { moduleIndex, result } of results) {
        const wizardModule = data.modules[moduleIndex];
        const moduleTitle = wizardModule?.title || `Module ${moduleIndex + 1}`;

        const moduleLessons = adaptModulesForRenderingV46(
          result.articleMeta,
          result.articleMarkdown,
          result.slidesJson,
          perModuleDuration,
        ).map((lesson, index) => ({
          ...lesson,
          id: `m${moduleIndex}-${index}`,
          order: lessons.length + index,
          moduleIndex,
          moduleTitle,
        }));

        const moduleQuiz = adaptQuizForRenderingV46(result.quizJson).map((question) => ({
          ...question,
          moduleIndex,
          moduleTitle,
        }));

        lessons.push(...moduleLessons);
        quiz.push(...moduleQuiz);

        courseModules.push({
          moduleIndex,
          title: moduleTitle,
          objective: wizardModule?.objective || null,
          completionDeadlineDays: wizardModule?.completionDeadlineDays ?? null,
          documentId: wizardModule?.documentId ?? null,
          lessons: moduleLessons,
          quiz: moduleQuiz,
          warning: result.error,
        });

        artifacts.push({
          moduleIndex,
          moduleTitle,
          articleMeta: result.articleMeta,
          articleMarkdown: result.articleMarkdown,
          slidesJson: result.slidesJson,
          quizJson: result.quizJson,
          judgeJson: result.judgeJson,
        });

        if (result.error) warnings.push(`${moduleTitle}: ${result.error}`);
      }

      const merged = mergeModuleArtifacts(artifacts, data.title);

      const content: GeneratedCourse = {
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        duration: data.duration,
        objectives: data.objectives || [],
        modules: lessons,
        quiz,
        courseModules,
        rawArticleMeta: merged.rawArticleMeta,
        rawArticleMarkdown: merged.rawArticleMarkdown,
        rawSlidesJson: merged.rawSlidesJson,
        rawJudgeJson: merged.rawJudgeJson,
        rawQuizJson: merged.rawQuizJson,
        sourceText: results
          .map(({ result }) => result.sourceText)
          .filter(Boolean)
          .join('\n\n'),
        ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
      };

      setGeneratedContent(content);
      setEditedModules(lessons);
      setSourceTextByModule(
        Object.fromEntries(
          results
            .filter(({ result }) => !!result.sourceText)
            .map(({ moduleIndex, result }) => [moduleIndex, result.sourceText as string]),
        ),
      );
      // The run is over — nothing left for the courses-list banner to resume.
      clearPendingGeneration();
      onComplete(content);
    },
    [data, onComplete],
  );

  // Generation lifecycle — poll cadence, poll cap, terminal-state handling and
  // unmount cleanup all live in the transport-agnostic useMultiJobStatus hook.
  // `failed` still wins over a raw error so the sanitized, user-safe message
  // always shows (THER-013), and the client-side backstop guarantees the UI can
  // never spin forever (THER-002).
  const { jobs, progress, failedModules, error, retryModule, retryAll } =
    useMultiJobStatus<GeneratedCourseV46>({
      enabled: !hasInitialContent,
      moduleIndexes: wizardModules.map((_, index) => index),
      initialJobs: pendingJobs ?? undefined,
      intervalMs: POLL_INTERVAL_MS,
      maxPollMs: MAX_POLL_MS,
      fallbackError: GENERATION_ERROR_MESSAGE,
      onAllCompleted: buildCourseFromResults,
      onJobsCreated: (created) => writePendingGeneration(created, data),
      createJobs: async (moduleIndexes) => {
        // Shares are derived from the full module list, so retrying one module
        // asks for exactly the questions it was originally allotted.
        const shares = distributeQuestionCount(
          parseInt(data.quizQuestionCount, 10) || 0,
          wizardModules.length,
        );

        const requests: ModuleGenerationRequest[] = [];
        const missingDocument: MultiJobCreateResult[] = [];

        for (const moduleIndex of moduleIndexes) {
          const wizardModule = wizardModules[moduleIndex];
          if (!wizardModule?.documentId) {
            missingDocument.push({
              moduleIndex,
              error: `“${wizardModule?.title || `Module ${moduleIndex + 1}`}” has no training document.`,
            });
            continue;
          }
          requests.push({
            moduleIndex,
            documentId: wizardModule.documentId,
            title: wizardModule.title,
            objective: wizardModule.objective,
            quizQuestionCount: shares[moduleIndex],
          });
        }

        if (requests.length === 0) return missingDocument;

        const { jobs: startedJobs, error: batchError } = await startModuleGenerationJobs(
          data,
          requests,
        );

        if (batchError) {
          return [
            ...missingDocument,
            ...requests.map(({ moduleIndex }) => ({ moduleIndex, error: batchError })),
          ];
        }

        return [...missingDocument, ...startedJobs];
      },
      poll: (jobId) => checkCourseGenerationJobV46(jobId),
    });

  const hasFailures = !!error || failedModules.length > 0;
  // Still generating until every module's job terminally completes or fails.
  const isGenerating = !hasInitialContent && !generatedContent && !hasFailures;

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  // Number of leading checklist items already done. The last item covers the
  // client-side aggregation, which runs the moment every job completes.
  const completedStages =
    (progress.jobsCreated ? 1 : 0) +
    (progress.allStarted ? 1 : 0) +
    (progress.allCompleted ? 1 : 0);

  // Persists the running jobs so the courses-list banner can track them and the
  // wizard can resume rather than generating a second time.
  const handleGotoDashboard = () => {
    writePendingGeneration(
      jobs
        .filter((job) => job.jobId)
        .map((job) => ({ moduleIndex: job.moduleIndex, jobId: job.jobId as string })),
      data,
    );
    window.location.href = '/dashboard/courses';
  };

  const handleModuleChange = (index: number) => {
    if (index < 0 || index >= editedModules.length) return;
    setActiveModuleIndex(index);
  };

  const handleSwitchView = (mode: 'slides' | 'article') => {
    setViewMode(mode);
  };

  if (hasFailures && !generatedContent) {
    const allFailed = failedModules.length === wizardModules.length;

    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-5 py-24 text-center">
        <div className="flex flex-col gap-3">
          <h2 className="text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-[#383838] md:text-[36px]">
            {allFailed ? 'Generation Failed' : 'Some modules could not be generated'}
          </h2>
          <p className="text-[15px] font-medium leading-[1.44] text-[#424242] md:text-base">
            {error || failedModules[0]?.error || GENERATION_ERROR_MESSAGE}
          </p>
        </div>

        {!allFailed && failedModules.length > 0 && (
          <ul className="flex w-full max-w-[520px] flex-col gap-2 text-left">
            {failedModules.map((job) => (
              <li
                key={job.moduleIndex}
                className="flex items-center justify-between gap-4 rounded-[10px] border-[1.5px] border-[#e5e7ea] px-4 py-3"
              >
                <span className="text-[15px] font-medium text-[#383838]">
                  {wizardModules[job.moduleIndex]?.title || `Module ${job.moduleIndex + 1}`}
                </span>
                <Button variant="outline" size="sm" onClick={() => retryModule(job.moduleIndex)}>
                  Retry module
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="default"
          onClick={retryAll}
          className="h-[52px] rounded-[12px] px-10 text-base font-semibold md:h-[56px] md:text-[18px]"
        >
          Try Again
        </Button>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col items-center gap-10 px-5 pt-24 pb-[60px] text-center md:pt-[170px]">
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-[26px] font-bold leading-[1.33] tracking-[-0.02em] text-[#383838] md:text-[36px]">
            Your course is being created…
          </h2>
          <p className="max-w-[640px] text-[15px] font-medium leading-[1.44] text-[#424242] md:text-base">
            We&apos;re reviewing your document to create the course. You&apos;ll receive an email
            notification once the course is complete and ready for review.
          </p>
        </div>

        <ul
          aria-live="polite"
          className="flex w-full max-w-[460px] flex-col gap-[18px] rounded-[12px] border-[1.5px] border-[#e5e7ea] px-8 py-8 text-left"
        >
          {GENERATION_STAGES.map((stage, index) => {
            const isDone = index < completedStages;
            const isCurrent = index === completedStages;

            return (
              <li key={stage} className="flex items-center gap-3">
                {isDone ? (
                  <Check className="size-[18px] shrink-0 text-[#666d80]" aria-hidden="true" />
                ) : isCurrent ? (
                  <Loader2
                    className="size-[18px] shrink-0 animate-spin text-[#666d80]"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle className="size-[18px] shrink-0 text-[#d2d5db]" aria-hidden="true" />
                )}
                <span
                  className={`text-[15px] font-medium leading-[1.44] md:text-base ${
                    isDone || isCurrent ? 'text-[#424242]' : 'text-[#9ca3af]'
                  }`}
                >
                  {stage}
                </span>
              </li>
            );
          })}
        </ul>

        <Button
          variant="default"
          onClick={handleGotoDashboard}
          className="h-[52px] w-full max-w-[300px] rounded-[12px] px-10 text-base font-semibold md:h-[56px] md:text-[18px]"
        >
          Goto Dashboard
        </Button>
      </div>
    );
  }

  const currentModule = editedModules[activeModuleIndex];
  const currentWizardModule =
    currentModule?.moduleIndex === undefined ? undefined : wizardModules[currentModule.moduleIndex];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-5 pt-10">
      {viewMode === 'slides' ? (
        <WizardReviewSlides
          lessons={editedModules}
          activeIndex={activeModuleIndex}
          onSelectLesson={handleModuleChange}
          onViewNotes={() => handleSwitchView('article')}
        />
      ) : (
        <WizardReviewArticle
          courseTitle={data.title}
          courseDescription={data.description}
          categoryName={categoryName}
          lessons={editedModules}
          activeIndex={activeModuleIndex}
          onSelectLesson={handleModuleChange}
          onViewSlides={() => handleSwitchView('slides')}
          lastUpdatedLabel={lastUpdatedLabel}
          sourceDocumentName={currentWizardModule?.fileName}
          sourceExcerpt={
            currentModule?.moduleIndex === undefined
              ? undefined
              : sourceTextByModule[currentModule.moduleIndex]
          }
        />
      )}

      {(() => {
        const coverageNote = (generatedContent?.rawQuizJson as { meta?: { coverageNote?: string } })
          ?.meta?.coverageNote;
        if (!coverageNote) return null;

        const noteLower = coverageNote.toLowerCase();
        const hasShortfall =
          !noteLower.includes('no gaps') && !noteLower.includes('all requested questions');

        if (!hasShortfall) return null;

        return (
          <div className="flex flex-col overflow-hidden rounded-md border border-[#fcd34d]">
            <div className="bg-[#fcd34d] text-black font-semibold px-3.5 py-[0.4rem] text-xs tracking-[0.04em] uppercase">
              CONTENT SHORTFALL
            </div>
            <div className="flex items-start gap-2.5 bg-[#fef2f2] px-3.5 py-3 text-black text-[0.8125rem] leading-[1.5]">
              <TriangleAlert
                className="shrink-0 mt-[0.1rem] text-[#dc2626]"
                width="16"
                height="16"
                strokeWidth={2.5}
              />
              <div className="m-0 [&_strong]:text-[#dc2626] [&_strong]:font-semibold">
                <strong>Less content generated due to the uploaded document content:</strong>{' '}
                {coverageNote}
              </div>
            </div>
          </div>
        );
      })()}

      {generatedContent?.warning && (
        <div className="rounded-md border border-[#F59E0B] bg-[#FEF3C7] px-4 py-3 text-[13px] text-[#92400E]">
          ⚠ {generatedContent.warning}
        </div>
      )}
    </div>
  );
}
