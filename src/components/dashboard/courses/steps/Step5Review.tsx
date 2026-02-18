'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { generateCourseAI } from '@/app/actions/course-ai';
import styles from '@/components/courses/CoursePlayer.module.css';

// Reusable Components
import CourseRail from '@/components/courses/CourseRail';
import CourseSlide from '@/components/courses/CourseSlide';
import CourseArticle from '@/components/courses/CourseArticle';

// Import React Quill dynamically
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });
import 'react-quill-new/dist/quill.snow.css';

interface Step5ReviewProps {
    data: any;
    documents: any[];
    initialContent?: any;
    onComplete: (content: any) => void;
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

    // Generate Request
    useEffect(() => {
        // If we already have content, don't generate
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

                const result = await generateCourseAI(formData);

                if (result.error) {
                    setError(result.error);
                } else {
                    setGeneratedContent(result);
                    if (result.modules) {
                        setEditedModules(result.modules);
                    }
                    onComplete(result);
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

    const handleContentUpdate = (newContent: string) => {
        const newModules = [...editedModules];
        newModules[activeModuleIndex] = { ...newModules[activeModuleIndex], content: newContent };
        setEditedModules(newModules);
        updateParent(newModules);
    };

    const handleTitleUpdate = (newTitle: string) => {
        const newModules = [...editedModules];
        newModules[activeModuleIndex] = { ...newModules[activeModuleIndex], title: newTitle };
        setEditedModules(newModules);
        updateParent(newModules);
    };

    const updateParent = (modules: any[]) => {
        const newContent = { ...generatedContent, modules };
        setGeneratedContent(newContent);
        onComplete(newContent);
    };

    // Quill Config
    const quillModules = {
        toolbar: [
            [{ 'header': [1, 2, false] }],
            ['bold', 'italic', 'underline'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['clean']
        ],
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
                    <p style={{ color: '#6B7280', fontSize: 14 }}>AI is analyzing your documents and building the course.</p>
                </div>
            </div>
        );
    }

    const currentModule = editedModules[activeModuleIndex];

    return (
        <div className={styles.playerContainer}>
            {/* Reusable Rail */}
            <CourseRail
                lessons={editedModules}
                activeIndex={activeModuleIndex}
                onSelect={handleModuleChange}
            // No locking in Edit/Review mode
            />

            {/* Main Area */}
            <div className={styles.main}>
                {/* Topbar - We keep this local because it has Step 5 specific view toggle state */}
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
                                content: currentModule?.content,
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
                            title={
                                <input
                                    className={styles.articleTitleInput}
                                    value={currentModule?.title || ''}
                                    onChange={(e) => handleTitleUpdate(e.target.value)}
                                    placeholder="Untitled module"
                                />
                            }
                            moduleLabel={`Module ${activeModuleIndex + 1}`}
                            onNext={() => handleModuleChange(activeModuleIndex + 1)}
                            onPrev={() => handleModuleChange(activeModuleIndex - 1)}
                            isFirst={activeModuleIndex === 0}
                            isLast={activeModuleIndex === editedModules.length - 1}
                        >
                            <div className={styles.quillWrapper}>
                                <ReactQuill
                                    theme="snow"
                                    value={currentModule?.content || ''}
                                    onChange={handleContentUpdate}
                                    modules={quillModules}
                                />
                            </div>
                        </CourseArticle>
                    )}
                </div>
            </div>
        </div>
    );
}
