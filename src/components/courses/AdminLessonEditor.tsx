'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import CourseArticle from '@/components/courses/CourseArticle';
import { updateLessonContent } from '@/app/actions/course';
import 'react-quill-new/dist/quill.snow.css';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sanitizeHtml } from '@/lib/sanitize';
import { logger } from '@/lib/logger';

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
      logger.error({ msg: 'Failed to save lesson:', err: error });
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
            className="w-full overflow-hidden border-0 border-b border-dashed border-b-[#cbd5e0] bg-transparent p-0 text-[36px] font-extrabold leading-[1.15] tracking-[-0.03em] text-foreground outline-none resize-none font-[inherit] max-md:text-[26px] max-[480px]:text-[22px]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lesson Title"
            rows={1}
          />
        ) : (
          <h1 className="text-[36px] font-extrabold tracking-[-0.03em] text-foreground leading-[1.15] max-md:text-[26px] max-[480px]:text-[22px]">
            {title}
          </h1>
        )
      }
      onNext={onNext}
      onPrev={onPrev}
      isFirst={isFirst}
      isLast={isLast}
    >
      <div className="mb-5 flex justify-end gap-3">
        {isEditing ? (
          <>
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setIsEditing(true)}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit Article
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="[&_.ql-container]:!text-[18px] [&_.ql-container]:font-[450] [&_.ql-container]:leading-[1.8] [&_.ql-container]:text-text-secondary [&_.ql-container]:font-[inherit] [&_.ql-container]:!border-none [&_.ql-editor]:!p-0 [&_.ql-toolbar]:!border-none [&_.ql-toolbar]:!border-b [&_.ql-toolbar]:!border-b-[#f3f4f6] [&_.ql-toolbar]:mb-6 [&_.ql-toolbar]:bg-transparent [&_.ql-toolbar]:!py-2 [&_.ql-toolbar]:!px-0">
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
