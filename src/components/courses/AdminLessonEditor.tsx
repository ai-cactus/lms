'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import CourseArticle from '@/components/courses/CourseArticle';
import styles from '@/components/courses/CoursePlayer.module.css';
import { updateLessonContent } from '@/app/actions/course';
import 'react-quill-new/dist/quill.snow.css';

// Import React Quill dynamically
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

interface AdminLessonEditorProps {
    lesson: {
        id: string;
        title: string;
        content: string;
        moduleIndex: number;
        totalModules: number;
    };
    onNext: () => void;
    onPrev: () => void;
    isFirst: boolean;
    isLast: boolean;
}

export default function AdminLessonEditor({ lesson, onNext, onPrev, isFirst, isLast }: AdminLessonEditorProps) {
    const [content, setContent] = useState(lesson.content);
    const [title, setTitle] = useState(lesson.title);
    const [isSaving, setIsSaving] = useState(false);

    // Sync state if lesson changes
    React.useEffect(() => {
        setContent(lesson.content);
        setTitle(lesson.title);
    }, [lesson.id, lesson.content, lesson.title]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updateLessonContent(lesson.id, content, title);
            // Optional: Show toast
        } catch (error) {
            console.error('Failed to save lesson:', error);
            alert('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
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

    return (
        <CourseArticle
            title={
                <input
                    className={styles.articleTitleInput}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Lesson Title"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px dashed #cbd5e0',
                        fontSize: 'inherit',
                        fontWeight: 'inherit',
                        color: 'inherit',
                        width: '100%',
                        outline: 'none'
                    }}
                />
            }
            moduleLabel={`Module ${lesson.moduleIndex + 1}`}
            onNext={onNext}
            onPrev={onPrev}
            isFirst={isFirst}
            isLast={isLast}
        >
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        opacity: isSaving ? 0.7 : 1
                    }}
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            <div className={styles.quillWrapper}>
                <ReactQuill
                    theme="snow"
                    value={content}
                    onChange={setContent}
                    modules={quillModules}
                />
            </div>
        </CourseArticle>
    );
}
