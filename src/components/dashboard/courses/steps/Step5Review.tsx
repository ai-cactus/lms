'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from '../CourseWizard.module.css';
import { generateCourseAI } from '@/app/actions/course-ai';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

// Import React Quill dynamically to avoid SSR issues
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });
import 'react-quill-new/dist/quill.snow.css';

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

    // View Mode State
    const [viewMode, setViewMode] = useState<'article' | 'slides'>('article');
    const [editedModules, setEditedModules] = useState<any[]>([]);

    useEffect(() => {
        if (generatedContent?.modules) {
            setEditedModules(generatedContent.modules);
        }
    }, [generatedContent]);

    // Quill Modules
    const modules = {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            ['clean']
        ],
    };

    const handleContentChange = (content: string) => {
        const newModules = [...editedModules];
        newModules[activeModuleIndex] = { ...newModules[activeModuleIndex], content };
        setEditedModules(newModules);

        // Auto-save to parent
        const newContent = {
            ...generatedContent,
            modules: newModules
        };
        setGeneratedContent(newContent);
        if (onComplete) {
            onComplete(newContent);
        }
    };

    const handleTitleChange = (title: string) => {
        const newModules = [...editedModules];
        newModules[activeModuleIndex] = { ...newModules[activeModuleIndex], title };
        setEditedModules(newModules);
        // Auto-save to parent
        const newContent = {
            ...generatedContent,
            modules: newModules
        };
        setGeneratedContent(newContent);
        if (onComplete) {
            onComplete(newContent);
        }
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

    const currentModule = editedModules[activeModuleIndex];

    return (
        <div className={`${styles.stepWrapper} ${styles.stepWrapperWide}`}>
            <div className={styles.reviewHeader}>
                <div className={styles.headerTitle}>
                    <h2 className={styles.stepTitle}>Review Course Content</h2>
                    <p className={styles.stepSubtitle}>Review and edit your course modules.</p>
                </div>
                <div className={styles.viewControls}>
                    <button
                        className={`${styles.viewBtn} ${viewMode === 'article' ? styles.viewBtnActive : ''}`}
                        onClick={() => setViewMode('article')}
                    >
                        Article Editor
                    </button>
                    <button
                        className={`${styles.viewBtn} ${viewMode === 'slides' ? styles.viewBtnActive : ''}`}
                        onClick={() => setViewMode('slides')}
                    >
                        Slide Preview
                    </button>
                </div>
            </div>

            {/* Split Screen Layout */}
            <div className={styles.splitLayout}>
                {/* Left Sidebar - Module List */}
                <div className={styles.sidebar}>
                    <h3 className={styles.sidebarTitle}>Course Modules</h3>
                    <div className={styles.moduleList}>
                        {editedModules.map((mod: any, i: number) => (
                            <button
                                key={i}
                                className={`${styles.moduleItem} ${i === activeModuleIndex ? styles.moduleItemActive : ''}`}
                                onClick={() => setActiveModuleIndex(i)}
                            >
                                <span className={styles.moduleNum}>{i + 1}</span>
                                <div className={styles.moduleInfo}>
                                    <span className={styles.moduleTitle}>{mod.title}</span>
                                    <span className={styles.moduleDuration}>{mod.duration || '10 min'}</span>
                                </div>
                                {i === activeModuleIndex && <div className={styles.activeIndicator} />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Right Panel - Editor */}
                <div className={styles.editorPanel}>
                    {viewMode === 'article' ? (
                        <div className={styles.articlePaper}>
                            <input
                                type="text"
                                className={styles.paperTitleInput}
                                value={currentModule?.title || ''}
                                onChange={(e) => handleTitleChange(e.target.value)}
                                placeholder="Module Title"
                            />
                            <div className={styles.quillWrapper}>
                                <ReactQuill
                                    theme="snow"
                                    value={currentModule?.content || ''}
                                    onChange={handleContentChange}
                                    modules={modules}
                                />
                            </div>

                            {/* Sticky Bottom Navigation Bar (Optional but helpful for linear flow) */}
                            <div className={styles.stickyBottomBar}>
                                <button
                                    className={styles.stickyNavBtn}
                                    onClick={() => setActiveModuleIndex(Math.max(0, activeModuleIndex - 1))}
                                    disabled={activeModuleIndex === 0}
                                >
                                    ← Previous
                                </button>
                                <span className={styles.stickyNavInfo}>
                                    Module {activeModuleIndex + 1} of {editedModules.length}
                                </span>
                                <button
                                    className={styles.stickyNavBtn}
                                    onClick={() => setActiveModuleIndex(Math.min(editedModules.length - 1, activeModuleIndex + 1))}
                                    disabled={activeModuleIndex === editedModules.length - 1}
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.previewContainer}>
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
                                        <h3 className={styles.slideTitle}>{currentModule?.title}</h3>
                                        <div
                                            className={styles.slideBody}
                                            dangerouslySetInnerHTML={{ __html: currentModule?.content || '' }}
                                        />
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
