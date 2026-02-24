'use client';

import React, { useState, useEffect, useRef } from 'react';
import { generateCourseAndQuizV3 } from '@/app/actions/course-ai-v3';
import styles from '@/components/courses/CoursePlayer.module.css';

// Reusable Components
import CourseRail from '@/components/courses/CourseRail';
import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';

interface Step5ReviewProps {
    data: any;
    documents: any[];
    initialContent?: any;
    onComplete: (content: any) => void;
}

/**
 * Converts v3.1 structured sections into an HTML string for backward-compatible rendering.
 * This is the adapter between the new plain-text `paragraphs[]` format and
 * the existing HTML-based rendering in CourseSlide/CourseArticle.
 */
function sectionsToHtml(sections: any[]): string {
    if (!sections || sections.length === 0) return '';

    return sections.map(section => {
        let html = '';

        // Section heading
        if (section.heading) {
            html += `<h3>${section.heading}</h3>`;
        }

        // Paragraphs
        if (section.paragraphs && section.paragraphs.length > 0) {
            html += section.paragraphs.map((p: string) => `<p>${p}</p>`).join('');
        }

        // Do This
        if (section.doThis && section.doThis.length > 0) {
            html += `<h4 style="color:#38A169;margin-top:16px;">✓ Do This</h4><ul>`;
            html += section.doThis.map((item: string) => `<li>${item}</li>`).join('');
            html += '</ul>';
        }

        // Avoid This
        if (section.avoidThis && section.avoidThis.length > 0) {
            html += `<h4 style="color:#E53E3E;margin-top:16px;">✕ Avoid This</h4><ul>`;
            html += section.avoidThis.map((item: string) => `<li>${item}</li>`).join('');
            html += '</ul>';
        }

        // Signals to Escalate
        if (section.signalsToEscalate && section.signalsToEscalate.length > 0) {
            html += `<h4 style="color:#D69E2E;margin-top:16px;">⚠ Escalation Signals</h4><ul>`;
            html += section.signalsToEscalate.map((item: string) => `<li>${item}</li>`).join('');
            html += '</ul>';
        }

        return html;
    }).join('');
}

/**
 * Converts v3.1 slides into a single HTML string for the Slide view.
 */
function slidesToHtml(slides: any[]): string {
    if (!slides || slides.length === 0) return '';

    return slides.map(slide => {
        let html = '';
        if (slide.slideTitle) {
            html += `<h3>${slide.slideTitle}</h3>`;
        }
        if (slide.bullets && slide.bullets.length > 0) {
            html += '<ul>';
            html += slide.bullets.map((b: string) => `<li>${b}</li>`).join('');
            html += '</ul>';
        }
        return html;
    }).join('');
}

/**
 * Adapts v3.1 CourseV3 modules into the format expected by existing rendering components
 * and CourseWizard data flow: { title, content, duration, ... }
 */
function adaptModulesForRendering(courseJson: any): any[] {
    if (!courseJson?.modules) return [];

    return courseJson.modules.map((mod: any) => ({
        // Legacy-compatible fields
        title: mod.moduleTitle,
        content: sectionsToHtml(mod.sections),
        slideContent: slidesToHtml(mod.slides),
        duration: `${Math.round((courseJson.meta?.estimatedDurationMinutes || 60) / courseJson.modules.length)} min`,
        // v3.1 rich data (preserved for future use)
        moduleId: mod.moduleId,
        moduleSummary: mod.moduleSummary,
        sections: mod.sections,
        slides: mod.slides,
        keyTerms: mod.keyTerms,
        objectivesCovered: mod.objectivesCovered,
    }));
}

/**
 * Adapts v3.1 QuizV3 questions into the format expected by Step6QuizReview
 * and createFullCourse: { question, options, answer, type, ... }
 */
function adaptQuizForRendering(quizJson: any): any[] {
    if (!quizJson?.questions) return [];

    return quizJson.questions.map((q: any) => ({
        // Legacy-compatible fields
        question: q.text,
        options: q.options,
        answer: q.correctAnswer,
        type: 'multiple_choice',
        // v3.1 rich data
        id: q.id,
        moduleId: q.moduleId,
        moduleTitle: q.moduleTitle,
        objectiveId: q.objectiveId,
        difficulty: q.difficulty,
        archetype: q.archetype,
        evidence: q.evidence,
        explanation: q.explanation,
        qualityFlags: q.qualityFlags,
    }));
}

export default function Step5Review({ data, documents, initialContent, onComplete }: Step5ReviewProps) {
    // Core State
    const hasInitialContent = !!initialContent?.modules;
    const [isGenerating, setIsGenerating] = useState(!hasInitialContent);
    const [generatedContent, setGeneratedContent] = useState<any>(initialContent || null);
    const [error, setError] = useState<string | null>(null);
    const [editedModules, setEditedModules] = useState<any[]>(initialContent?.modules || []);

    // UI View State
    const [viewMode, setViewMode] = useState<'slides' | 'article'>('slides');
    const [activeModuleIndex, setActiveModuleIndex] = useState(0);

    // Generation Ref
    const hasStartedRef = useRef(false);

    // Generate Request — v3.1 two-stage pipeline
    useEffect(() => {
        if (hasInitialContent) return;
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        const generate = async () => {
            try {
                const formData = new FormData();
                formData.append('data', JSON.stringify(data));
                const selectedDoc = documents.find(d => d.selected && d.file);
                if (selectedDoc?.file) {
                    formData.append('file', selectedDoc.file);
                }

                const result = await generateCourseAndQuizV3(formData);

                if (result.error && !result.courseJson) {
                    setError(result.error);
                } else {
                    // Adapt v3.1 output for the existing UI flow
                    const adaptedModules = adaptModulesForRendering(result.courseJson);
                    const adaptedQuiz = adaptQuizForRendering(result.quizJson);

                    const content = {
                        modules: adaptedModules,
                        quiz: adaptedQuiz,
                        // Preserve raw v3.1 JSON for DB persistence
                        rawCourseJson: result.courseJson,
                        rawQuizJson: result.quizJson,
                        sourceText: result.sourceText,
                        // Pass along any partial errors (e.g., quiz failed)
                        ...(result.error ? { warning: result.error } : {}),
                    };

                    setGeneratedContent(content);
                    if (content.modules) {
                        setEditedModules(content.modules);
                    }
                    onComplete(content);
                }
                setIsGenerating(false);
            } catch (err) {
                console.error("Generation failed", err);
                setError("An unexpected response was received from the server.");
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

    const updateParent = (modules: any[]) => {
        const newContent = { ...generatedContent, modules };
        setGeneratedContent(newContent);
        onComplete(newContent);
    };

    // Loading / Error States
    if (error) {
        return (
            <div className={styles.playerContainer} style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ color: '#EF4444', marginBottom: 8 }}>Generation Failed</h2>
                    <p style={{ color: '#6B7280' }}>{error}</p>
                    <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#1a1a1a', color: 'white', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Try Again</button>
                </div>
            </div>
        );
    }

    if (isGenerating) {
        return (
            <div className={styles.playerContainer} style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 40, height: 40, border: '3px solid #E5E7EB', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }}></div>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                    <h2 style={{ fontSize: 18, fontWeight: 600 }}>Generation in progress...</h2>
                    <p style={{ color: '#6B7280', fontSize: 14 }}>AI is analyzing your documents and building the course and quiz.</p>
                    <p style={{ color: '#9CA3AF', fontSize: 12, marginTop: 8 }}>This uses a two-stage pipeline for higher quality output.</p>
                </div>
            </div>
        );
    }

    const currentModule = editedModules[activeModuleIndex];

    // Choose content based on view mode
    const displayContent = viewMode === 'slides'
        ? (currentModule?.slideContent || currentModule?.content || '')
        : (currentModule?.content || '');

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
                        <span className={styles.breadcrumbActive}>{currentModule?.title || 'Untitled Module'}</span>
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
                                totalModules: editedModules.length
                            }}
                            onNext={() => handleModuleChange(activeModuleIndex + 1)}
                            onPrev={() => handleModuleChange(activeModuleIndex - 1)}
                            isFirst={activeModuleIndex === 0}
                            isLast={activeModuleIndex === editedModules.length - 1}
                        />
                    ) : (
                        <CourseArticle
                            title={currentModule?.title || 'Untitled Module'}
                        >
                            <div
                                className={styles.articleBody}
                                dangerouslySetInnerHTML={{ __html: displayContent }}
                            />
                        </CourseArticle>
                    )}
                </div>

                {/* Warning banner for partial failures */}
                {generatedContent?.warning && (
                    <div style={{
                        padding: '12px 16px',
                        background: '#FEF3C7',
                        borderTop: '1px solid #F59E0B',
                        color: '#92400E',
                        fontSize: 13,
                    }}>
                        ⚠ {generatedContent.warning}
                    </div>
                )}
            </div>
        </div>
    );
}
