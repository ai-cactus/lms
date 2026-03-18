'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  generateCourseAndQuizV46,
  checkCourseGenerationJobV46,
} from '@/app/actions/course-ai-v4.6';
import styles from '@/components/courses/CoursePlayer.module.css';

// Reusable Components
import CourseRail from '@/components/courses/CourseRail';
import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';
import { Button } from '@/components/ui';
import { sanitizeHtml } from '@/lib/sanitize';

import DOMPurify from 'isomorphic-dompurify';
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
  onBack?: () => void;
}

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
      // Wrap consecutive <li> tags in <ul>
      .replace(/(<li>[\s\S]*?<\/li>)(\n?)(?!<li>)/g, (match) => `<ul>${match}</ul>`)
      .replace(/<\/ul>\n?<ul>/g, '\n')
  );
}

/**
 * Converts v4.6 slides into a single HTML string for the Slide view.
 */
function slidesV46ToHtml(slides: { title?: string; bullets?: string[] }[]): string {
  if (!slides || slides.length === 0) return '';

  return slides
    .map((slide) => {
      let html = '';
      if (slide.title) {
        html += `<h3>${slide.title}</h3>`;
      }
      if (slide.bullets && slide.bullets.length > 0) {
        html += '<ul>';
        html += slide.bullets.map((b: string) => `<li>${b}</li>`).join('');
        html += '</ul>';
      }
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
      // Save previous section
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

  // Push last section
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
  slidesJson:
    | { slides: { title?: string; bullets?: string[]; sourceSections?: string[] }[] }
    | null
    | undefined,
  estimatedDurationMinutes?: number,
): RenderableModule[] => {
  const markdownSections = splitMarkdownSections(articleMarkdown);
  const metaSections = articleMeta?.sections || [];
  const slides = slidesJson?.slides || [];

  // Map each articleMeta section to a module
  return metaSections.map(
    (section: { title: string; sectionId: string; keyPoints?: string[] }, idx: number) => {
      // Find matching markdown section by title
      const mdSection =
        markdownSections.find(
          (s) =>
            s.title.toLowerCase().includes(section.title.toLowerCase()) ||
            section.title.toLowerCase().includes(s.title.toLowerCase()),
        ) || markdownSections[idx];

      // Find slides that reference this section
      const sectionSlides = slides.filter((sl: { sourceSections?: string[] }) =>
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
 * Adapts v4.6 quiz questions into the format expected by Step6QuizReview
 * and createFullCourse: { question, options: string[], answer: number, ... }
 */
const adaptQuizForRenderingV46 = (
  quizJson: { questions: RawAIQuizQuestion[] } | null | undefined,
): QuizQuestion[] => {
  if (!quizJson?.questions) return [];
  return quizJson.questions.map((q) => {
    // Find correct answer index
    const correctIdx = (q.options as { isCorrect: boolean }[]).findIndex((o) => o.isCorrect);

    // Build explanation from option explanations
    const correctOption = (q.options as { isCorrect: boolean; explanation?: string }[]).find(
      (o) => o.isCorrect,
    );
    const incorrectOptions: Record<string, string> = {};
    (q.options as { isCorrect: boolean; explanation?: string }[]).forEach((o, idx: number) => {
      if (!o.isCorrect) {
        incorrectOptions[String(idx)] = o.explanation || '';
      }
    });

    return {
      // Legacy-compatible fields expected by Step6QuizReview
      question: q.question,
      options: (q.options as { text: string }[]).map((o) => o.text),
      answer: correctIdx >= 0 ? correctIdx : 0,
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
  onBack,
}: Step5ReviewProps) {
  // Core State
  const [isGenerating, setIsGenerating] = useState(!initialContent);
  const [generatedContent, setGeneratedContent] = useState<GeneratedCourse | null>(
    initialContent || null,
  );
  const [error, setError] = useState<string | null>(null);

  // UI View State
  const [viewMode, setViewMode] = useState<'slides' | 'article'>('slides');
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [editedModules, setEditedModules] = useState<RenderableModule[]>(
    initialContent?.modules || [],
  );

  // Generation Ref
  const hasStartedRef = useRef(false);
  const hasInitialContent = !!initialContent;

  // Generate Request — v4.6 five-stage pipeline
  useEffect(() => {
    if (hasInitialContent) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const generate = async () => {
      try {
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

        const { jobId, error: startError } = await generateCourseAndQuizV46(formData);

        if (startError || !jobId) {
          setError(startError || 'Failed to start generation job');
          setIsGenerating(false);
          return;
        }

        // Poll for completion
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await checkCourseGenerationJobV46(jobId);

            if (statusRes.error) {
              clearInterval(pollInterval);
              setError(statusRes.error);
              setIsGenerating(false);
            } else if (statusRes.status === 'failed') {
              clearInterval(pollInterval);
              setError('Generation failed during processing.');
              setIsGenerating(false);
            } else if (statusRes.status === 'completed' && statusRes.result) {
              clearInterval(pollInterval);
              const result = statusRes.result;

              // Adapt v4.6 output for the existing UI flow
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
              setIsGenerating(false);
            }
            // If status is 'processing', keep polling
          } catch (pollErr) {
            console.error('Polling failed', pollErr);
          }
        }, 3000);
      } catch (err) {
        console.error('Generation failed', err);
        setError('An unexpected response was received from the server.');
        setIsGenerating(false);
      }
    };

    generate();
  }, [data, documents, onComplete, hasInitialContent]);

  // Handlers
  const handleModuleChange = (index: number) => {
    if (index < 0 || index >= editedModules.length) return;
    setActiveModuleIndex(index);
  };

  const handleSwitchView = (mode: 'slides' | 'article') => {
    setViewMode(mode);
  };

  const updateParent = (modules: RenderableModule[]) => {
    if (!generatedContent) return;
    const newContent = { ...generatedContent, modules };
    setGeneratedContent(newContent);
    onComplete(newContent);
  };

  // Loading / Error States
  if (error && !generatedContent) {
    return (
      <div
        className={styles.playerContainer}
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: '#EF4444', marginBottom: 8 }}>Generation Failed</h2>
          <p style={{ color: '#6B7280', marginBottom: 16 }}>{error}</p>
          <Button variant="primary" size="md" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div
        className={styles.playerContainer}
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #E5E7EB',
              borderTopColor: '#1a1a1a',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 24px',
            }}
          ></div>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1A202C', marginBottom: 8 }}>
            Creating your course and quiz…
          </h2>
          <p style={{ color: '#4A5568', fontSize: 15, lineHeight: 1.6, marginBottom: 8 }}>
            We&apos;re reading your documents, pulling out the key points, and turning them into a
            clear course with a quiz.
          </p>
          <p style={{ color: '#A0AEC0', fontSize: 13 }}>
            You&apos;ll be able to review and edit everything before publishing.
          </p>
          <a
            href="/dashboard"
            style={{
              display: 'inline-block',
              marginTop: 32,
              fontSize: 14,
              fontWeight: 600,
              color: '#4C6EF5',
              textDecoration: 'none',
            }}
          >
            ← Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  const currentModule = editedModules[activeModuleIndex];

  // Choose content based on view mode
  const displayContent =
    viewMode === 'slides'
      ? currentModule?.slideContent || currentModule?.content || ''
      : (generatedContent?.rawArticleMarkdown ? articleMarkdownToHtml(generatedContent.rawArticleMarkdown) : currentModule?.content || '');

  return (
    <div className={styles.playerContainer}>
      {/* Reusable Rail */}
      <CourseRail
        lessons={editedModules}
        activeIndex={activeModuleIndex}
        onSelect={handleModuleChange}
      />

      {/* Main Area */}
      <div className={styles.main}>
        {/* Topbar */}
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <span className={styles.breadcrumb}>Course</span>
            <span className={styles.breadcrumbSep}>›</span>
            <span className={styles.breadcrumbActive}>
              {currentModule?.title || 'Untitled Module'}
            </span>
            <span className={styles.durationPill}>{currentModule?.duration || '10 min'}</span>
          </div>
          <div className={styles.toggle}>
            <button
              className={`${styles.toggleBtn} ${viewMode === 'article' ? styles.toggleBtnActive : ''}`}
              onClick={() => handleSwitchView('article')}
            >
              ARTICLE
            </button>
            <button
              className={`${styles.toggleBtn} ${viewMode === 'slides' ? styles.toggleBtnActive : ''}`}
              onClick={() => handleSwitchView('slides')}
            >
              SLIDE
            </button>
          </div>
        </header>

        {/* Content Stage */}
        <div className={styles.contentArea}>
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
            />
          ) : (
            <CourseArticle title={currentModule?.title || 'Untitled Module'}>
              <div
                className={styles.articleBody}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayContent) }}
              />
            </CourseArticle>
          )}
        </div>

        {/* Warning banner for partial failures */}
        {generatedContent?.warning && (
          <div
            style={{
              padding: '12px 16px',
              background: '#FEF3C7',
              borderTop: '1px solid #F59E0B',
              color: '#92400E',
              fontSize: 13,
            }}
          >
            ⚠ {generatedContent.warning}
          </div>
        )}
      </div>
    </div>
  );
}
