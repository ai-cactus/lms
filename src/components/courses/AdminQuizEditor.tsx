'use client';

import React, { useState } from 'react';
import styles from '@/components/dashboard/courses/CourseWizard.module.css'; // Reusing exact styles
import { updateQuizQuestions } from '@/app/actions/course';
import { useRouter } from 'next/navigation';
import { generateSingleQuestion } from '@/app/actions/quiz-ai';
import { Button } from '@/components/ui';

interface QuizQuestion {
    question: string;
    options: string[];
    answer: number;
    type?: string;
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
    }[];
}

export default function AdminQuizEditor({ courseId, initialQuestions }: AdminQuizEditorProps) {
    const router = useRouter();

    // Transform initial questions to local state format
    const [questions, setQuestions] = useState<QuizQuestion[]>(
        initialQuestions.map(q => ({
            question: q.text,
            options: q.options,
            answer: q.options.indexOf(q.correctAnswer) >= 0 ? q.options.indexOf(q.correctAnswer) : 0,
            type: q.type
        }))
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
        type: 'multiple_choice'
    });

    const handleAddQuestion = () => {
        if (!newQuestion.question.trim() || (newQuestion.type !== 'true_false' && newQuestion.options.some(o => !o.trim()))) {
            alert("Please fill in all fields.");
            return;
        }
        setQuestions([...questions, newQuestion]);
        setIsAdding(false);
        setNewQuestion({ question: '', options: ['', '', '', ''], answer: 0, type: 'multiple_choice' });
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
                    type: res.question.type
                });
            } else {
                alert(res.error || 'Failed to generate question with AI.');
            }
        } catch (error) {
            console.error('Failed to call AI generation:', error);
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
            console.error('Failed to save quiz:', error);
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

    return (
        <div className={`${styles.stepWrapper} ${styles.stepWrapperFlex}`} style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 0', height: 'auto', overflow: 'visible' }}>
            <h2 className={styles.stepTitle}>Edit Quiz Questions</h2>
            <p className={styles.stepSubtitle}>
                Manage questions for this course. Changes are applied immediately after saving.
            </p>

            <div className={styles.quizReviewContainer} style={{ height: 'auto', maxHeight: 'none' }}>
                {/* Header Row */}
                <div className={styles.quizHeaderRow}>
                    <div className={styles.quizHeaderLeft}>
                        <div className={styles.quizSectionTitle}>Questions</div>
                        <div className={styles.quizSubtitle}>{questions.length} Questions</div>
                    </div>
                    <Button
                        variant="primary"
                        className={styles.btnNext}
                        style={{ width: 'auto', padding: '8px 24px', height: '40px' }}
                        onClick={handleSaveQuiz}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>

                {/* Flat Question List */}
                <div className={styles.questionListWrapper} style={{ maxHeight: 'none', overflow: 'visible' }}>
                    {questions.length === 0 ? (
                        <div className={styles.emptyState}>
                            No questions available. Add one below.
                        </div>
                    ) : (
                        questions.map((q, index) => {
                            const isEditing = editingIndex === index;
                            if (isEditing && editingQuestion) {
                                return (
                                    <div key={index} className={styles.questionCard} style={{ border: '2px solid #4C6EF5' }}>
                                        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>Edit Question {index + 1}</h4>
                                        <div className={styles.formGroup}>
                                            <label>Question Type</label>
                                            <select
                                                className={styles.typeSelect}
                                                value={editingQuestion.type}
                                                onChange={(e) => {
                                                    const type = e.target.value;
                                                    setEditingQuestion({
                                                        ...editingQuestion,
                                                        type,
                                                        options: type === 'true_false' ? ['True', 'False'] : ['', '', '', ''],
                                                        answer: 0
                                                    });
                                                }}
                                            >
                                                <option value="multiple_choice">Multiple Choice</option>
                                                <option value="true_false">True / False</option>
                                            </select>
                                        </div>

                                        <div className={styles.formGroup}>
                                            <label>Question Text</label>
                                            <input
                                                type="text"
                                                className={styles.formInput}
                                                value={editingQuestion.question}
                                                onChange={(e) => setEditingQuestion({ ...editingQuestion, question: e.target.value })}
                                            />
                                        </div>

                                        <div className={styles.formGroup}>
                                            <label>Options (Select correct answer)</label>
                                            <div className={styles.optionsGrid}>
                                                {editingQuestion.options.map((opt, i) => (
                                                    <div key={i} className={styles.optionInputRow}>
                                                        <input
                                                            type="radio"
                                                            name={`editCorrectAnswer-${index}`}
                                                            checked={editingQuestion.answer === i}
                                                            onChange={() => setEditingQuestion({ ...editingQuestion, answer: i })}
                                                        />
                                                        <input
                                                            type="text"
                                                            className={styles.formInput}
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

                                        <div className={styles.formActions}>
                                            <Button variant="outline" className={styles.btnCancel} onClick={() => { setEditingIndex(null); setEditingQuestion(null); }}>Cancel</Button>
                                            <Button variant="primary" className={styles.btnSave} onClick={() => {
                                                if (!editingQuestion.question.trim() || editingQuestion.options.some(o => !o.trim())) {
                                                    alert("Please fill in all fields.");
                                                    return;
                                                }
                                                const updatedQuiz = [...questions];
                                                updatedQuiz[index] = editingQuestion;
                                                setQuestions(updatedQuiz);
                                                setEditingIndex(null);
                                                setEditingQuestion(null);
                                            }}>Save Changes</Button>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={index} className={styles.questionCard}>
                                    <div className={styles.questionHeader}>
                                        <div className={styles.questionText}>
                                            <span style={{ fontWeight: 'bold', marginRight: 8 }}>{index + 1}.</span>
                                            {q.question}
                                            {q.type && (
                                                <span className={styles.badge} style={{
                                                    marginLeft: 10,
                                                    background: q.type === 'true_false' ? '#E9D8FD' : '#EBF8FF',
                                                    color: q.type === 'true_false' ? '#6B46C1' : '#3182CE'
                                                }}>
                                                    {q.type.replace('_', ' ')}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                style={{ background: 'transparent', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', color: '#4A5568', cursor: 'pointer' }}
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
                                                style={{ background: 'transparent', border: '1px solid #FED7D7', borderRadius: '6px', padding: '4px 12px', color: '#EF4444', cursor: 'pointer', fontSize: '12px' }}
                                                onClick={() => handleDeleteQuestion(index)}
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                    <div className={styles.optionList}>
                                        {q.options.map((opt, optIndex) => (
                                            <div key={optIndex} className={styles.optionItem}>
                                                <div
                                                    className={`${styles.radioCircle} ${q.answer === optIndex ? styles.radioSelected : ''}`}
                                                />
                                                {opt}
                                                {q.answer === optIndex && <span style={{ marginLeft: 8, fontSize: 12, color: '#48BB78', fontWeight: 600 }}>(Correct)</span>}
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
                    <Button variant="outline" className={styles.btnAddQuestion} onClick={() => setIsAdding(true)}>
                        + Add New Question
                    </Button>
                ) : (
                    <div className={styles.addQuestionForm}>
                        <h3 className={styles.formTitle}>Add New Question</h3>

                        <div className={styles.formGroup}>
                            <label>Question Type</label>
                            <select
                                className={styles.typeSelect}
                                value={newQuestion.type}
                                onChange={(e) => {
                                    const type = e.target.value;
                                    setNewQuestion({
                                        ...newQuestion,
                                        type,
                                        options: type === 'true_false' ? ['True', 'False'] : ['', '', '', ''],
                                        answer: 0
                                    });
                                }}
                            >
                                <option value="multiple_choice">Multiple Choice</option>
                                <option value="true_false">True / False</option>
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label>Question Text</label>
                            <input
                                type="text"
                                className={styles.formInput}
                                placeholder="Enter your question here..."
                                value={newQuestion.question}
                                onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label>Options (Select correct answer)</label>
                            <div className={styles.optionsGrid}>
                                {newQuestion.options.map((opt, i) => (
                                    <div key={i} className={styles.optionInputRow}>
                                        <input
                                            type="radio"
                                            name="correctAnswer"
                                            checked={newQuestion.answer === i}
                                            onChange={() => setNewQuestion({ ...newQuestion, answer: i })}
                                        />
                                        <input
                                            type="text"
                                            className={styles.formInput}
                                            value={opt}
                                            onChange={(e) => updateOption(i, e.target.value)}
                                            placeholder={`Option ${i + 1}`}
                                            disabled={newQuestion.type === 'true_false'}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.formActions} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <Button
                                    variant="outline"
                                    className={styles.btnAddQuestion}
                                    onClick={(e) => { e.preventDefault(); handleGenerateQuestion(); }}
                                    disabled={isGenerating}
                                    style={{ width: 'auto', margin: 0, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    {isGenerating ? 'Generating...' : (
                                        <>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 2v4"></path>
                                                <path d="M12 18v4"></path>
                                                <path d="M4.93 4.93l2.83 2.83"></path>
                                                <path d="M16.24 16.24l2.83 2.83"></path>
                                                <path d="M2 12h4"></path>
                                                <path d="M18 12h4"></path>
                                                <path d="M4.93 19.07l2.83-2.83"></path>
                                                <path d="M16.24 7.76l2.83-2.83"></path>
                                            </svg>
                                            Generate with AI
                                        </>
                                    )}
                                </Button>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <Button variant="outline" className={styles.btnCancel} onClick={() => setIsAdding(false)}>Cancel</Button>
                                <Button variant="primary" className={styles.btnSave} onClick={handleAddQuestion}>Save Question</Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
