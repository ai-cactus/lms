'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from '../CourseWizard.module.css';
import { generateCourseAI } from '@/app/actions/course-ai';
import { motion, AnimatePresence } from 'framer-motion';

interface Step5ReviewProps {
    data: any;
    documents: any[];
    onComplete: (content: any) => void;
}

export default function Step5Review({ data, documents, onComplete }: Step5ReviewProps) {
    const [isGenerating, setIsGenerating] = useState(true);
    const [checklistStep, setChecklistStep] = useState(0);
    const [generatedContent, setGeneratedContent] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // UI State
    const [activeModuleIndex, setActiveModuleIndex] = useState(0);
    const [activeCitationId, setActiveCitationId] = useState<number | null>(null);
    const sourceViewRef = useRef<HTMLDivElement>(null);

    // View Mode State
    const [viewMode, setViewMode] = useState<'article' | 'slides' | 'split'>('split'); // Default to split for admin review
    const [isEditing, setIsEditing] = useState(false);
    const [editedModules, setEditedModules] = useState<any[]>([]);

    useEffect(() => {
        if (generatedContent?.modules) {
            setEditedModules(generatedContent.modules);
        }
    }, [generatedContent]);

    // Auto-scroll source text when slide changes or citation clicked
    useEffect(() => {
        if (viewMode === 'split' && generatedContent?.citations) {
            // Find citations relevant to current module or active citation
            // For now, let's just highlight the active citation if present
            if (activeCitationId) {
                const mark = sourceViewRef.current?.querySelector(`mark[data-id="${activeCitationId}"]`);
                if (mark) {
                    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }, [activeCitationId, viewMode, activeModuleIndex]);

    const handleSaveEdit = () => {
        setIsEditing(false);
        const newContent = {
            ...generatedContent,
            modules: editedModules
        };
        setGeneratedContent(newContent);
        if (onComplete) {
            onComplete(newContent);
        }
    };

    const handleModuleChange = (index: number, field: 'title' | 'content', value: string) => {
        const newModules = [...editedModules];
        newModules[index] = { ...newModules[index], [field]: value };
        setEditedModules(newModules);
    };

    const hasStartedRef = useRef(false);

    const checklistItems = [
        'Reading source document',
        'Extracting key concepts',
        'Generating course structure',
        'Creating quiz questions',
        'Finalizing citations'
    ];

    useEffect(() => {
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        const generate = async () => {
            try {
                let step = 0;
                const interval = setInterval(() => {
                    if (step < checklistItems.length - 1) {
                        step++;
                        setChecklistStep(step);
                    }
                }, 1500);

                const formData = new FormData();
                formData.append('data', JSON.stringify(data));

                const selectedDoc = documents.find(d => d.selected && d.file);
                if (selectedDoc?.file) {
                    formData.append('file', selectedDoc.file);
                }

                const result = await generateCourseAI(formData);

                clearInterval(interval);
                setChecklistStep(checklistItems.length);

                if (result.error) {
                    setError(result.error);
                } else {
                    setGeneratedContent(result);
                    onComplete(result);
                }
                setIsGenerating(false);
            } catch (err) {
                console.error("Generation failed", err);
                setError("An unexpected error occurred during generation.");
                setIsGenerating(false);
            }
        };

        generate();
    }, [data, documents, onComplete]);

    const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.dataset.citationId) {
            const id = parseInt(target.dataset.citationId, 10);
            setActiveCitationId(id);
        }
    };

    const processContent = (html: string) => {
        if (!html) return '';
        return html.replace(/\[(\d+)\]/g, (match, id) => {
            const numId = parseInt(id, 10);
            const isActive = activeCitationId === numId;
            return `<span class="${styles.citationBadge} ${isActive ? styles.citationActive : ''}" data-citation-id="${id}">${match}</span>`;
        });
    };

    const renderSourceText = () => {
        if (!generatedContent?.sourceText) return <p className={styles.emptyState}>No source text available.</p>;

        let processedHtml = generatedContent.sourceText.replace(/\n/g, '<br/>');
        const citations = generatedContent.citations || [];

        citations.forEach((cit: any) => {
            if (cit.quote) {
                const escapedQuote = cit.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedQuote})`, '');
                processedHtml = processedHtml.replace(regex, `<mark data-id="${cit.id}" class="${activeCitationId === cit.id ? styles.markActive : ''}">$1</mark>`);
            }
        });

        return <div dangerouslySetInnerHTML={{ __html: processedHtml }} />;
    };

    if (error) {
        return (
            <div className={styles.stepWrapper}>
                <div className={styles.generationContainer}>
                    <h2 className={styles.stepTitle} style={{ color: '#E53E3E' }}>Generation Failed</h2>
                    <p className={styles.stepSubtitle}>{error}</p>
                    <button className={styles.btnDashboard} onClick={() => window.location.reload()}>Try Again</button>
                </div>
            </div>
        );
    }

    if (isGenerating) {
        return (
            <div className={styles.stepWrapper}>
                <div className={styles.generationContainer}>
                    <h2 className={styles.stepTitle}>Analysis & Generation</h2>
                    <p className={styles.stepSubtitle}>AI user is reading your documents and designing the course.</p>
                    <div className={styles.processingCard}>
                        <div className={styles.checklist}>
                            {checklistItems.map((item, index) => {
                                const isDone = checklistStep > index;
                                const isCurrent = checklistStep === index;
                                return (
                                    <div key={index} className={`${styles.checklistItem} ${isDone ? styles.completed : ''} ${isCurrent ? styles.active : ''}`}>
                                        <div className={styles.iconWrapper}>
                                            {isDone ? <div className={styles.checkIcon}>✓</div> : isCurrent ? <div className={styles.spinner} /> : <div className={styles.dot} />}
                                        </div>
                                        <span>{item}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const currentModule = isEditing ? editedModules[activeModuleIndex] : generatedContent?.modules?.[activeModuleIndex];

    return (
        <div className={styles.stepWrapper}>
            <div className={styles.reviewHeader}>
                <div className={styles.headerTitle}>
                    <h2 className={styles.stepTitle}>Review Course Content</h2>
                    <p className={styles.stepSubtitle}>Review generated modules and verify citations against the source.</p>
                </div>
                <div className={styles.viewControls}>
                    <button
                        className={`${styles.viewBtn} ${viewMode === 'split' ? styles.viewBtnActive : ''}`}
                        onClick={() => setViewMode('split')}
                    >
                        Split View
                    </button>
                    <button
                        className={`${styles.viewBtn} ${viewMode === 'slides' ? styles.viewBtnActive : ''}`}
                        onClick={() => setViewMode('slides')}
                    >
                        Slides
                    </button>
                    <button
                        className={`${styles.viewBtn} ${viewMode === 'article' ? styles.viewBtnActive : ''}`}
                        onClick={() => setViewMode('article')}
                    >
                        Article
                    </button>
                </div>
            </div>

            <div className={`${styles.contentContainer} ${styles[viewMode]}`}>
                {/* Left Side: Slide/Content */}
                <div className={styles.mainContent}>
                    <div className={styles.slideCardWrapper}>
                        <AnimatePresence mode='wait'>
                            <motion.div
                                key={activeModuleIndex}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                                className={styles.slideCard}
                            >
                                <div className={styles.slideHeader}>
                                    <span className={styles.moduleBadge}>Module {activeModuleIndex + 1}</span>
                                    <span className={styles.durationBadge}>{currentModule?.duration || '10 min'}</span>
                                </div>

                                {isEditing ? (
                                    <div className={styles.editMode}>
                                        <input
                                            type="text"
                                            className={styles.editTitleInput}
                                            value={currentModule?.title || ''}
                                            onChange={(e) => handleModuleChange(activeModuleIndex, 'title', e.target.value)}
                                        />
                                        <textarea
                                            className={styles.editContentInput}
                                            value={currentModule?.content || ''}
                                            onChange={(e) => handleModuleChange(activeModuleIndex, 'content', e.target.value)}
                                        />
                                        <button className={styles.btnSave} onClick={handleSaveEdit}>Save Changes</button>
                                    </div>
                                ) : ( // View Mode
                                    <>
                                        <h3 className={styles.slideTitle}>{currentModule?.title}</h3>
                                        <div
                                            className={styles.slideBody}
                                            onClick={handleContentClick}
                                            dangerouslySetInnerHTML={{ __html: processContent(currentModule?.content) }}
                                        />
                                    </>
                                )}
                            </motion.div>
                        </AnimatePresence>

                        <div className={styles.slideNavigation}>
                            <button
                                className={styles.navBtn}
                                disabled={activeModuleIndex === 0}
                                onClick={() => setActiveModuleIndex(i => i - 1)}
                            >
                                ← Prev
                            </button>
                            <div className={styles.slideIndicators}>
                                {generatedContent?.modules?.map((_: any, i: number) => (
                                    <div
                                        key={i}
                                        className={`${styles.indicator} ${i === activeModuleIndex ? styles.indicatorActive : ''}`}
                                        onClick={() => setActiveModuleIndex(i)}
                                    />
                                ))}
                            </div>
                            <button
                                className={styles.navBtn}
                                disabled={activeModuleIndex === (generatedContent?.modules?.length || 0) - 1}
                                onClick={() => setActiveModuleIndex(i => i + 1)}
                            >
                                Next →
                            </button>
                        </div>

                        {!isEditing && (
                            <button className={styles.editBtnFloating} onClick={() => setIsEditing(true)}>
                                Edit Content
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Side: Source Reference (Visible in Split Mode) */}
                {viewMode === 'split' && (
                    <div className={styles.sourcePanel}>
                        <div className={styles.sourceHeader}>
                            <h3>Ref Image / Source Text</h3>
                            <span className={styles.sourceBadge}>{documents.find(d => d.selected)?.name || 'Document'}</span>
                        </div>
                        <div className={styles.sourceContent} ref={sourceViewRef}>
                            {renderSourceText()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

