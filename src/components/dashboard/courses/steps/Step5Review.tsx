'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from '../CourseWizard.module.css';
import { generateCourseAI } from '@/app/actions/course-ai';

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
    const [sidebarTab, setSidebarTab] = useState<'modules' | 'source'>('modules');
    const [activeCitationId, setActiveCitationId] = useState<number | null>(null);
    const sourceViewRef = useRef<HTMLDivElement>(null);

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    const [editedModules, setEditedModules] = useState<any[]>([]);

    useEffect(() => {
        if (generatedContent?.modules) {
            setEditedModules(generatedContent.modules);
        }
    }, [generatedContent]);

    const handleSaveEdit = () => {
        setIsEditing(false);
        setGeneratedContent((prev: any) => ({
            ...prev,
            modules: editedModules
        }));
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

    // AI Generation Effect
    useEffect(() => {
        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        const generate = async () => {
            try {
                // Simulate checklist progress
                let step = 0;
                const interval = setInterval(() => {
                    if (step < checklistItems.length - 1) {
                        step++;
                        setChecklistStep(step);
                    }
                }, 1500);

                // Prepare FormData with File
                const formData = new FormData();
                formData.append('data', JSON.stringify(data));

                // Find the selected file
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
                    // Switch to source tab if citations exist to show off the feature? 
                    // No, stick to modules first.
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

    // Handle Citation Click
    const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.dataset.citationId) {
            const id = parseInt(target.dataset.citationId, 10);
            setActiveCitationId(id);
            setSidebarTab('source');

            // Scroll to highlight (allow render first)
            setTimeout(() => {
                const mark = sourceViewRef.current?.querySelector(`mark[data-id="${id}"]`);
                if (mark) {
                    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    };

    // Process Content to inject clickable spans for [1]
    const processContent = (html: string) => {
        if (!html) return '';
        // Replace [1], [2] etc with <span ...>
        return html.replace(/\[(\d+)\]/g, (match, id) => {
            const numId = parseInt(id, 10);
            const isActive = activeCitationId === numId;
            return `<span class="${styles.citationBadge} ${isActive ? styles.citationActive : ''}" data-citation-id="${id}">${match}</span>`;
        });
    };

    // Render Source Text with Highlights
    const renderSourceText = () => {
        if (!generatedContent?.sourceText) return <p className={styles.emptyState}>No source text available.</p>;

        const text = generatedContent.sourceText;
        const citations = generatedContent.citations || [];

        // We need to highlight parts of the text.
        // Simple approach: Split text by quotes. 
        // Note: This is fragile if quotes overlap or repeat. V1 implementation.

        // Let's create a map of ranges or just replace first occurrence?
        // Replacing is safer for display.

        let processedHtml = text.replace(/\n/g, '<br/>'); // Preserve line breaks

        citations.forEach((cit: any) => {
            if (cit.quote) {
                // Escape regex special chars in quote
                const escapedQuote = cit.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Wrap first occurrence in mark
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
                    <p className={styles.stepSubtitle}>AI agent is reading your documents and designing the course.</p>
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
                <h2 className={styles.stepTitle}>Review Course Content</h2>
                <p className={styles.stepSubtitle}>Review generated modules and verify citations against the source.</p>
            </div>

            <div className={styles.reviewContainer}>
                {/* Main Article */}
                <div className={styles.reviewMain}>
                    {isEditing ? (
                        <div className={styles.editMode}>
                            <input
                                type="text"
                                className={styles.editTitleInput}
                                value={currentModule?.title || ''}
                                onChange={(e) => handleModuleChange(activeModuleIndex, 'title', e.target.value)}
                            />
                            <div className={styles.articleMeta}>
                                <span>{currentModule?.duration || '10 min'} read</span>
                                <span className={styles.badge}>Editing</span>
                            </div>
                            <textarea
                                className={styles.editContentInput}
                                value={currentModule?.content || ''}
                                onChange={(e) => handleModuleChange(activeModuleIndex, 'content', e.target.value)}
                            />
                            <button className={styles.btnSave} onClick={handleSaveEdit}>Save Changes</button>
                        </div>
                    ) : (
                        <>
                            <div className={styles.articleHeader}>
                                <div className={styles.articleTitle}>{currentModule?.title}</div>
                                <div className={styles.articleMeta}>
                                    <span>{currentModule?.duration || '10 min'} read</span>
                                    <span className={styles.badge}>AI Generated</span>
                                </div>
                            </div>

                            <div
                                className={styles.articleContent}
                                onClick={handleContentClick}
                                dangerouslySetInnerHTML={{ __html: processContent(currentModule?.content) }}
                            />
                        </>
                    )}

                    {/* Navigation Buttons */}
                    <div className={styles.moduleNav}>
                        <button
                            className={styles.navBtn}
                            disabled={activeModuleIndex === 0}
                            onClick={() => setActiveModuleIndex(i => i - 1)}
                        >
                            ← Previous Lesson
                        </button>
                        <button
                            className={styles.navBtn}
                            disabled={activeModuleIndex === (generatedContent?.modules?.length || 0) - 1}
                            onClick={() => setActiveModuleIndex(i => i + 1)}
                        >
                            Next Lesson →
                        </button>
                    </div>
                </div>

                {/* Sidebar */}
                <div className={styles.reviewSidebar}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                        {!isEditing ? (
                            <button 
                                className={`${styles.sidebarBtn} ${styles.sidebarBtnOutline}`}
                                onClick={() => setIsEditing(true)}
                            >
                                Edit Module
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                        ) : (
                            <button 
                                className={`${styles.sidebarBtn} ${styles.sidebarBtnPrimary}`}
                                onClick={handleSaveEdit}
                            >
                                Save Changes
                            </button>
                        )}
                        <button className={`${styles.sidebarBtn} ${styles.sidebarBtnPrimary}`}>
                            View as Slides
                        </button>
                    </div>

                    <div className={styles.sidebarTabs}>
                        <button
                            className={`${styles.tab} ${sidebarTab === 'modules' ? styles.activeTab : ''}`}
                            onClick={() => setSidebarTab('modules')}
                        >
                            Modules
                        </button>
                        <button
                            className={`${styles.tab} ${sidebarTab === 'source' ? styles.activeTab : ''}`}
                            onClick={() => setSidebarTab('source')}
                        >
                            Source Ref
                        </button>
                    </div>

                    <div className={styles.sidebarContent}>
                        {sidebarTab === 'modules' ? (
                            <div className={styles.tocList}>
                                {generatedContent?.modules?.map((mod: any, i: number) => (
                                    <div
                                        key={i}
                                        className={`${styles.tocItem} ${i === activeModuleIndex ? styles.tocItemActive : ''}`}
                                        onClick={() => setActiveModuleIndex(i)}
                                    >
                                        <span className={styles.tocNum}>{i + 1}</span>
                                        {mod.title}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={styles.sourceView} ref={sourceViewRef}>
                                <div className={styles.sourceHeader}>
                                    Generated from {documents.find(d => d.selected)?.name || 'Uploaded Document'}
                                </div>
                                <div className={styles.sourceText}>
                                    {renderSourceText()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
