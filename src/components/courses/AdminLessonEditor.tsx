'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import CourseArticle from '@/components/courses/CourseArticle';
import styles from '@/components/courses/CoursePlayer.module.css';
import DOMPurify from 'isomorphic-dompurify';
import { updateLessonContent } from '@/app/actions/course';
import 'react-quill-new/dist/quill.snow.css';
import { Button } from '@/components/ui';
import { sanitizeHtml } from '@/lib/sanitize';

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

export default function AdminLessonEditor({
  lesson,
  onNext,
  onPrev,
  isFirst,
  isLast,
}: AdminLessonEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(lesson.content);
  const [title, setTitle] = useState(lesson.title);
  const [isSaving, setIsSaving] = useState(false);
  const titleRef = React.useRef<HTMLTextAreaElement>(null);

  // Sync state if lesson changes
  React.useEffect(() => {
    setContent(lesson.content);
    setTitle(lesson.title);
    setIsEditing(false); // Reset to read mode on change
  }, [lesson.id, lesson.content, lesson.title]);

  React.useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [title, isEditing]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateLessonContent(lesson.id, content, title);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save lesson:', error);
      alert('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setContent(lesson.content);
    setTitle(lesson.title);
    setIsEditing(false);
  };

  // Quill Config
  const quillModules = {
    toolbar: [
      [{ header: [1, 2, false] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['clean'],
    ],
  };

  return (
    <CourseArticle
      title={
        isEditing ? (
          <textarea
            ref={titleRef}
            className={styles.articleTitleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lesson Title"
            rows={1}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '1px dashed #cbd5e0',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              color: 'inherit',
              width: '100%',
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
            }}
          />
        ) : (
          <h1 className={styles.articleTitle}>{title}</h1>
        )
      }
      moduleLabel={`Module ${lesson.moduleIndex + 1}`}
      onNext={onNext}
      onPrev={onPrev}
      isFirst={isFirst}
      isLast={isLast}
    >
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        {isEditing ? (
          <>
            <Button variant="outline" size="md" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="md"
            onClick={() => setIsEditing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Article
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className={styles.quillWrapper}>
          <ReactQuill theme="snow" value={content} onChange={setContent} modules={quillModules} />
        </div>
      ) : (
        <div
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(
              (content || '')
                .replace(/&nbsp;/g, ' ')
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/\s+/g, ' '),
            ),
          }}
        />
      )}
    </CourseArticle>
  );
}
