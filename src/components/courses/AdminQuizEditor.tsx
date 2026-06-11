'use client';

import React, { useState } from 'react';
import { updateQuizQuestions } from '@/app/actions/course';
import { useRouter } from 'next/navigation';
import { generateSingleQuestion } from '@/app/actions/quiz-ai';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';
import { Sparkles } from 'lucide-react';

interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  type?: string;
  explanation?: string;
}

interface AdminQuizEditorProps {
  courseId: string;
  initialQuestions: {
    id: string;
    text: string;
    options: string[];
    correctAnswer: string;
    type: string;
    order: number;
    explanation?: string | null;
  }[];
}

export default function AdminQuizEditor({ courseId, initialQuestions }: AdminQuizEditorProps) {
  const router = useRouter();

  // Transform initial questions to local state format
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    initialQuestions.map((q) => ({
      question: q.text,
      options: q.options,
      answer: q.options.indexOf(q.correctAnswer) >= 0 ? q.options.indexOf(q.correctAnswer) : 0,
      type: q.type,
      explanation: q.explanation || '',
    })),
  );

  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);
  const [newQuestion, setNewQuestion] = useState<QuizQuestion>({
    question: '',
    options: ['', '', '', ''],
    answer: 0,
    type: 'multiple_choice',
    explanation: '',
  });

  const handleAddQuestion = () => {
    if (
      !newQuestion.question.trim() ||
      (newQuestion.type !== 'true_false' && newQuestion.options.some((o) => !o.trim()))
    ) {
      alert('Please fill in all fields.');
      return;
    }
    setQuestions([...questions, newQuestion]);
    setIsAdding(false);
    setNewQuestion({
      question: '',
      options: ['', '', '', ''],
      answer: 0,
      type: 'multiple_choice',
      explanation: '',
    });
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...newQuestion.options];
    newOptions[index] = value;
    setNewQuestion({ ...newQuestion, options: newOptions });
  };

  const handleGenerateQuestion = async () => {
    try {
      setIsGenerating(true);
      const res = await generateSingleQuestion({ courseId });
      if (res.success && res.question) {
        setNewQuestion({
          question: res.question.question,
          options: res.question.options,
          answer: res.question.answer,
          type: res.question.type,
          explanation: res.question.explanation || '',
        });
      } else {
        alert(res.error || 'Failed to generate question with AI.');
      }
    } catch (error) {
      logger.error({ msg: 'Failed to call AI generation:', err: error });
      alert('An unexpected error occurred.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveQuiz = async () => {
    try {
      setIsSaving(true);
      await updateQuizQuestions(courseId, questions);
      alert('Quiz updated successfully!');
      router.refresh();
    } catch (error) {
      logger.error({ msg: 'Failed to save quiz:', err: error });
      alert('Failed to save quiz. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteQuestion = (index: number) => {
    if (confirm('Are you sure you want to delete this question?')) {
      const newQuestions = [...questions];
      newQuestions.splice(index, 1);
      setQuestions(newQuestions);
    }
  };

  // .formInput / .typeSelect — full-width input box
  const formInputClass =
    'w-full rounded-lg border border-border px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_3px_rgba(76,110,245,0.1)]';

  return (
    // .stepWrapper + .stepWrapperFlex — flex column, centered, max-width 800px container.
    // Dynamic layout overrides (maxWidth/margin/padding/height/overflow) preserved inline.
    <div
      className="relative z-50 flex w-full flex-1 flex-col items-center"
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '40px 0',
        height: 'auto',
        overflow: 'visible',
      }}
    >
      {/* .stepTitle */}
      <h2 className="mb-5 flex-shrink-0 text-center text-[32px] font-bold tracking-[-0.5px] text-[#1a202c]">
        Edit Quiz Questions
      </h2>
      {/* .stepSubtitle */}
      <p className="mb-[30px] max-w-[600px] flex-shrink-0 text-center text-base leading-[1.5] text-text-secondary">
        Manage questions for this course. Changes are applied immediately after saving.
      </p>

      {/* .quizReviewContainer — dynamic height overrides preserved inline */}
      <div
        className="flex w-full flex-1 flex-col overflow-y-auto pr-2 pb-10"
        style={{ height: 'auto', maxHeight: 'none' }}
      >
        {/* Header Row — .quizHeaderRow */}
        <div className="mb-6 flex flex-shrink-0 items-center justify-between">
          {/* .quizHeaderLeft */}
          <div className="flex flex-col">
            {/* .quizSectionTitle */}
            <div className="mb-1 text-lg font-bold text-text-secondary">Questions</div>
            {/* .quizSubtitle */}
            <div className="text-sm text-text-tertiary">{questions.length} Questions</div>
          </div>
          {/* .btnNext + .btnNextEnabled — enabled primary action. Dynamic size overrides preserved inline. */}
          <Button
            variant="default"
            style={{ width: 'auto', padding: '8px 24px', height: '40px' }}
            onClick={handleSaveQuiz}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {/* Flat Question List — .questionListWrapper. Dynamic overflow overrides preserved inline. */}
        <div className="flex flex-col gap-5" style={{ maxHeight: 'none', overflow: 'visible' }}>
          {questions.length === 0 ? (
            // .emptyState
            <div className="rounded-xl border border-dashed border-border bg-[#f9fafb] p-10 text-center italic text-[#a0aec0]">
              No questions available. Add one below.
            </div>
          ) : (
            questions.map((q, index) => {
              const isEditing = editingIndex === index;
              if (isEditing && editingQuestion) {
                return (
                  // .questionCard — border override (editing) preserved inline (dynamic accent)
                  <div key={index} className="mb-8 w-full" style={{ border: '2px solid #4C6EF5' }}>
                    <h4 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>
                      Edit Question {index + 1}
                    </h4>

                    {/* .formGroup */}
                    <div className="mb-5">
                      <label className="mb-2 block text-sm font-semibold text-text-secondary">
                        Question Text
                      </label>
                      <input
                        type="text"
                        className={formInputClass}
                        value={editingQuestion.question}
                        onChange={(e) =>
                          setEditingQuestion({ ...editingQuestion, question: e.target.value })
                        }
                      />
                    </div>

                    {/* .formGroup */}
                    <div className="mb-5">
                      <label className="mb-2 block text-sm font-semibold text-text-secondary">
                        Options (Select correct answer)
                      </label>
                      {/* .optionsGrid */}
                      <div className="flex flex-col gap-3">
                        {editingQuestion.options.map((opt, i) => (
                          // .optionInputRow
                          <div key={i} className="flex items-center gap-3">
                            <input
                              type="radio"
                              name={`editCorrectAnswer-${index}`}
                              checked={editingQuestion.answer === i}
                              onChange={() => setEditingQuestion({ ...editingQuestion, answer: i })}
                            />
                            <input
                              type="text"
                              className={formInputClass}
                              value={opt}
                              onChange={(e) => {
                                const newOptions = [...editingQuestion.options];
                                newOptions[i] = e.target.value;
                                setEditingQuestion({ ...editingQuestion, options: newOptions });
                              }}
                              disabled={editingQuestion.type === 'true_false'}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* .formGroup — dynamic marginTop preserved inline */}
                    <div className="mb-5" style={{ marginTop: '16px' }}>
                      <label className="mb-2 block text-sm font-semibold text-text-secondary">
                        Detailed Explanation / Reference
                      </label>
                      <textarea
                        className={formInputClass}
                        style={{ minHeight: '80px', resize: 'vertical' }}
                        value={editingQuestion.explanation || ''}
                        onChange={(e) =>
                          setEditingQuestion({ ...editingQuestion, explanation: e.target.value })
                        }
                        placeholder="Provide a detailed explanation or cite the Standard Manual here..."
                      />
                    </div>

                    {/* .formActions */}
                    <div className="mt-6 flex justify-end gap-3">
                      {/* .btnCancel */}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingIndex(null);
                          setEditingQuestion(null);
                        }}
                      >
                        Cancel
                      </Button>
                      {/* .btnSave */}
                      <Button
                        variant="default"
                        onClick={() => {
                          if (
                            !editingQuestion.question.trim() ||
                            editingQuestion.options.some((o) => !o.trim())
                          ) {
                            alert('Please fill in all fields.');
                            return;
                          }
                          const updatedQuiz = [...questions];
                          updatedQuiz[index] = editingQuestion;
                          setQuestions(updatedQuiz);
                          setEditingIndex(null);
                          setEditingQuestion(null);
                        }}
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                // .questionCard
                <div key={index} className="mb-8 w-full">
                  {/* .questionHeader */}
                  <div className="mb-5 flex items-start justify-between">
                    {/* .questionText */}
                    <div className="flex-1 pr-4 text-base font-semibold leading-[1.5] text-text-secondary">
                      <span style={{ fontWeight: 'bold', marginRight: 8 }}>{index + 1}.</span>
                      {q.question}
                      {q.type && (
                        // .badge — dynamic background/color by type preserved inline
                        <span
                          className="rounded-xl px-2 py-0.5 text-[11px] font-semibold uppercase"
                          style={{
                            marginLeft: 10,
                            background: q.type === 'true_false' ? '#E9D8FD' : '#EBF8FF',
                            color: q.type === 'true_false' ? '#6B46C1' : '#3182CE',
                          }}
                        >
                          {q.type.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-[12px] text-text-secondary"
                        onClick={() => {
                          setEditingIndex(index);
                          setEditingQuestion(q);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-error/30 text-[12px] text-error"
                        onClick={() => handleDeleteQuestion(index)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {/* .optionList */}
                  <div className="flex flex-col gap-2.5 pl-6">
                    {q.options.map((opt, optIndex) => (
                      // .optionItem
                      <div
                        key={optIndex}
                        className="flex items-center rounded-lg border border-transparent px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-[#f7fafc]"
                      >
                        {/* .radioCircle + .radioSelected */}
                        <div
                          className={`relative mr-3 h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 ${
                            q.answer === optIndex
                              ? 'border-success bg-success shadow-[inset_0_0_0_3px_white]'
                              : 'border-[#cbd5e0]'
                          }`}
                        />
                        {opt}
                        {q.answer === optIndex && (
                          <span className="ml-2 text-xs font-semibold text-success">(Correct)</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add Question Section */}
        {!isAdding ? (
          // .btnAddQuestion — full-width dashed "add" tile
          <Button
            variant="outline"
            className="mt-6 flex h-auto w-full items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e0] bg-[#f7fafc] p-4 text-base font-semibold text-text-secondary hover:border-[#a0aec0] hover:bg-[#edf2f7]"
            onClick={() => setIsAdding(true)}
          >
            + Add New Question
          </Button>
        ) : (
          // .addQuestionForm
          <div className="mt-6 w-full">
            {/* .formTitle */}
            <h3 className="mb-5 text-lg font-bold text-text-secondary">Add New Question</h3>

            {/* .formGroup */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold text-text-secondary">
                Question Text
              </label>
              <input
                type="text"
                className={formInputClass}
                placeholder="Enter your question here..."
                value={newQuestion.question}
                onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
              />
            </div>

            {/* .formGroup */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold text-text-secondary">
                Options (Select correct answer)
              </label>
              {/* .optionsGrid */}
              <div className="flex flex-col gap-3">
                {newQuestion.options.map((opt, i) => (
                  // .optionInputRow
                  <div key={i} className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="correctAnswer"
                      checked={newQuestion.answer === i}
                      onChange={() => setNewQuestion({ ...newQuestion, answer: i })}
                    />
                    <input
                      type="text"
                      className={formInputClass}
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      disabled={newQuestion.type === 'true_false'}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* .formGroup — dynamic marginTop preserved inline */}
            <div className="mb-5" style={{ marginTop: '16px' }}>
              <label className="mb-2 block text-sm font-semibold text-text-secondary">
                Detailed Explanation / Reference
              </label>
              <textarea
                className={formInputClass}
                style={{ minHeight: '80px', resize: 'vertical' }}
                value={newQuestion.explanation || ''}
                onChange={(e) => setNewQuestion({ ...newQuestion, explanation: e.target.value })}
                placeholder="Provide a detailed explanation or cite the Standard Manual here..."
              />
            </div>

            {/* .formActions — overridden to space-between layout (dynamic) */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                {/* .btnAddQuestion used as the AI generate button; dynamic size/layout preserved inline */}
                <Button
                  variant="outline"
                  className="border-2 border-dashed border-[#cbd5e0] bg-[#f7fafc] font-semibold text-text-secondary hover:border-[#a0aec0] hover:bg-[#edf2f7]"
                  onClick={(e) => {
                    e.preventDefault();
                    handleGenerateQuestion();
                  }}
                  disabled={isGenerating}
                  style={{
                    width: 'auto',
                    margin: 0,
                    padding: '10px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {isGenerating ? (
                    'Generating...'
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      Generate with AI
                    </>
                  )}
                </Button>
              </div>
              <div className="flex gap-3">
                {/* .btnCancel */}
                <Button variant="outline" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                {/* .btnSave */}
                <Button variant="default" onClick={handleAddQuestion}>
                  Save Question
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
