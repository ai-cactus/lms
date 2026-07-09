'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  generateCourseAndQuizV46,
  checkCourseGenerationJobV46,
  type GeneratedCourseV46,
} from '@/app/actions/course-ai-v4.6';
import { useJobStatus } from '@/hooks/use-job-status';

import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';
import { Button } from '@/components/ui/button';
import { sanitizeHtml } from '@/lib/sanitize';
import { TriangleAlert } from 'lucide-react';

import {
  CourseWizardData,
  GeneratedCourse,
  CourseDocument,
  RenderableModule,
} from '@/types/course';

interface Step5ReviewProps {
  data: CourseWizardData;
  documents: CourseDocument[];
  initialContent?: GeneratedCourse | null;
  onComplete: (content: GeneratedCourse) => void;
  pendingJobId?: string | null;
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
 * Adapts v4.6 quiz questions into the format expected by Step6QuizReview
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
      // Legacy-compatible fields expected by Step6QuizReview
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

export default function Step5Review({
  data,
  documents,
  initialContent,
  onComplete,
  pendingJobId,
}: Step5ReviewProps) {
  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(
    initialContent || null,
  );

  const [viewMode, setViewMode] = useState<'slides' | 'article'>('article');
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [editedModules, setEditedModules] = useState<RenderableModule[]>(
    initialContent?.modules || [],
  );

  const hasInitialContent = !!initialContent;

  // Stores the active jobId so the "Back to Dashboard" button can persist it to localStorage
  const activeJobIdRef = useRef<string | null>(null);
  // The job currently being polled — set by createJob before polling starts.
  const jobIdRef = useRef<string | null>(null);
  // Only the first attempt resumes an in-flight job; a retry always starts fresh
  // (the previous job already failed), so pendingJobId is ignored after attempt 0.
  const attemptRef = useRef(0);

  // Adapts a completed v4.6 job result into the existing UI/course data flow.
  const buildCourseFromResult = useCallback(
    (result: GeneratedCourseV46) => {
      const adaptedModules = adaptModulesForRenderingV46(
        result.articleMeta,
        result.articleMarkdown,
        result.slidesJson,
        parseInt(data.duration) || 60,
      );
      const adaptedQuiz = adaptQuizForRenderingV46(result.quizJson);

      const content: GeneratedCourse = {
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        duration: data.duration,
        objectives: data.objectives || [],
        modules: adaptedModules,
        quiz: adaptedQuiz,
        // Preserve raw v4.6 JSON for DB persistence
        rawArticleMeta: result.articleMeta,
        rawArticleMarkdown: result.articleMarkdown,
        rawSlidesJson: result.slidesJson,
        rawJudgeJson: result.judgeJson,
        rawQuizJson: result.quizJson,
        sourceText: result.sourceText,
        // Pass along any partial errors
        ...(result.error ? { warning: result.error } : {}),
      };

      setGeneratedContent(content);
      if (content.modules) {
        setEditedModules(content.modules);
      }
      onComplete(content);
    },
    [data, onComplete],
  );

  // Generation lifecycle — polling cadence, poll cap, terminal-state handling
  // and unmount cleanup all live in the transport-agnostic useJobStatus hook.
  // `failed` still wins over a raw error (via fallbackError precedence in the
  // hook) so the sanitized, user-safe message always shows (THER-013), and the
  // client-side backstop guarantees the UI never spins forever (THER-002).
  const { error, retry } = useJobStatus<GeneratedCourseV46>({
    enabled: !hasInitialContent,
    intervalMs: POLL_INTERVAL_MS,
    maxPollMs: MAX_POLL_MS,
    fallbackError: GENERATION_ERROR_MESSAGE,
    onCompleted: buildCourseFromResult,
    createJob: async () => {
      // Only the first attempt resumes an in-flight job; retries start fresh.
      const isFirstAttempt = attemptRef.current === 0;
      attemptRef.current += 1;
      let jobId: string | undefined = isFirstAttempt ? (pendingJobId ?? undefined) : undefined;

      if (!jobId) {
        const formData = new FormData();
        formData.append('data', JSON.stringify(data));

        // Try to send the File blob if available (freshly uploaded)
        const selectedDocWithFile = documents.find((d) => d.selected && d.file);
        if (selectedDocWithFile?.file) {
          formData.append('file', selectedDocWithFile.file);
        }

        // Always pass the selected document ID so the server can
        // read from DB if no File blob is available
        const selectedDoc = documents.find((d) => d.selected);
        if (selectedDoc) {
          formData.append('documentId', selectedDoc.id);
        }

        const { jobId: newJobId, error: startError } = await generateCourseAndQuizV46(formData);

        if (startError || !newJobId) {
          return { error: startError || 'Failed to start generation job' };
        }
        jobId = newJobId;
      }

      // Store so the "Back to Dashboard" button can persist it, and so poll() reads it.
      activeJobIdRef.current = jobId;
      jobIdRef.current = jobId;
    },
    poll: () => checkCourseGenerationJobV46(jobIdRef.current as string),
  });

  // Still generating until the job terminally completes or fails.
  const isGenerating = !hasInitialContent && !generatedContent && !error;

  // "Try Again" — real retry without a full-page reload (THER-013): the hook
  // cancels any stale poll, clears error state, and re-runs createJob + polling.
  const handleRetry = () => {
    activeJobIdRef.current = null;
    retry();
  };

  // Called from the loading UI — saves job state so courses list can show a banner
  const handleBackToDashboard = (jobIdToSave: string) => {
    try {
      localStorage.setItem(
        'lms_pending_generation',
        JSON.stringify({ jobId: jobIdToSave, formData: data, timestamp: Date.now() }),
      );
    } catch {
      // localStorage may be unavailable (private browsing); silently continue
    }
    window.location.href = '/dashboard/courses';
  };

  const handleModuleChange = (index: number) => {
    if (index < 0 || index >= editedModules.length) return;
    setActiveModuleIndex(index);
  };

  const handleSwitchView = (mode: 'slides' | 'article') => {
    setViewMode(mode);
  };

  if (error && !generatedContent) {
    return (
      <div className="flex flex-row-reverse max-md:flex-col h-screen w-full bg-background-secondary text-[#1a1a1a] overflow-hidden font-sans items-center justify-center">
        <div className="text-center">
          <h2 className="text-red-500 mb-2">Generation Failed</h2>
          <p className="text-[#6B7280] mb-4">{error}</p>
          <Button variant="default" loading={isGenerating} onClick={handleRetry}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Capture jobId from the generate() closure via ref so the Back button can read it
  // (ref is declared near the top of the component, above all early returns)
  if (isGenerating) {
    return (
      <div className="flex flex-row-reverse max-md:flex-col h-screen w-full bg-background-secondary text-[#1a1a1a] overflow-hidden font-sans items-center justify-center">
        <div className="text-center max-w-[420px]">
          <div className="w-10 h-10 border-[3px] border-[#E5E7EB] border-t-[#1a1a1a] rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-xl font-bold text-[#1A202C] mb-2">Creating your course and quiz…</h2>
          <p className="text-[#4A5568] text-[15px] leading-relaxed mb-2">
            We&apos;re reading your documents, pulling out the key points, and turning them into a
            clear course with a quiz.
          </p>
          <p className="text-slate-400 text-[13px]">
            You&apos;ll be able to review and edit everything before publishing.
          </p>
          <p className="text-slate-400 text-xs mt-2">
            You can go back to the dashboard — generation will continue and you can resume from
            there.
          </p>
          <button
            onClick={() => handleBackToDashboard(activeJobIdRef.current ?? '')}
            className="inline-block mt-8 text-sm font-semibold text-[#4C6EF5] bg-none border-none cursor-pointer underline"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentModule = editedModules[activeModuleIndex];

  const displayContent =
    viewMode === 'slides'
      ? currentModule?.slideContent || currentModule?.content || ''
      : currentModule?.content || '';

  return (
    <div className="flex flex-row-reverse max-md:flex-col h-screen w-full bg-background-secondary text-[#1a1a1a] overflow-hidden font-sans">
      <div className="flex-1 flex flex-col overflow-hidden h-full w-full">
        <div className="flex-1 overflow-hidden relative h-full bg-[#f8f7f4]">
          {viewMode === 'slides' ? (
            <CourseSlide
              lesson={{
                title: currentModule?.title,
                content: displayContent,
                moduleIndex: activeModuleIndex,
                totalModules: editedModules.length,
              }}
              onNext={() => handleModuleChange(activeModuleIndex + 1)}
              onPrev={() => handleModuleChange(activeModuleIndex - 1)}
              isFirst={activeModuleIndex === 0}
              isLast={activeModuleIndex === editedModules.length - 1}
              onToggleView={() => handleSwitchView('article')}
            />
          ) : (
            <CourseArticle
              title={currentModule?.title || 'Untitled Module'}
              lessons={editedModules}
              activeIndex={activeModuleIndex}
              onSelectModule={handleModuleChange}
              onToggleView={() => handleSwitchView('slides')}
              onNext={() => handleModuleChange(activeModuleIndex + 1)}
              onPrev={() => handleModuleChange(activeModuleIndex - 1)}
              isFirst={activeModuleIndex === 0}
              isLast={activeModuleIndex === editedModules.length - 1}
            >
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayContent) }} />
            </CourseArticle>
          )}
        </div>

        {(() => {
          const coverageNote = (
            generatedContent?.rawQuizJson as { meta?: { coverageNote?: string } }
          )?.meta?.coverageNote;
          if (!coverageNote) return null;

          const noteLower = coverageNote.toLowerCase();
          const hasShortfall =
            !noteLower.includes('no gaps') && !noteLower.includes('all requested questions');

          if (!hasShortfall) return null;

          return (
            <div className="px-8 pb-6">
              <div className="flex flex-col overflow-hidden mt-2 rounded-md border border-[#fcd34d]">
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
            </div>
          );
        })()}

        {generatedContent?.warning && (
          <div className="px-4 py-3 bg-[#FEF3C7] border-t border-[#F59E0B] text-[#92400E] text-[13px]">
            ⚠ {generatedContent.warning}
          </div>
        )}
      </div>
    </div>
  );
}
