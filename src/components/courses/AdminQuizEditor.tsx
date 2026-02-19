'use client';

import React, { useState } from 'react';
import styles from '@/components/dashboard/courses/CourseWizard.module.css'; // Reusing exact styles
import { updateQuizQuestions } from '@/app/actions/course';
import { useRouter } from 'next/navigation';

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
    const [isSaving, setIsSaving] = useState(false);
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
                    <button
                        className={styles.btnNext}
                        style={{ width: 'auto', padding: '8px 24px', height: '40px' }}
                        onClick={handleSaveQuiz}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>

                {/* Flat Question List */}
                <div className={styles.questionListWrapper} style={{ maxHeight: 'none', overflow: 'visible' }}>
                    {questions.length === 0 ? (
                        <div className={styles.emptyState}>
                            No questions available. Add one below.
                        </div>
                    ) : (
                        questions.map((q, index) => (
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
                                    <button
                                        style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '12px' }}
                                        onClick={() => handleDeleteQuestion(index)}
                                    >
                                        Delete
                                    </button>
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
                        ))
                    )}
                </div>

                {/* Add Question Section */}
                {!isAdding ? (
                    <button className={styles.btnAddQuestion} onClick={() => setIsAdding(true)}>
                        + Add New Question
                    </button>
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

                        <div className={styles.formActions}>
                            <button className={styles.btnCancel} onClick={() => setIsAdding(false)}>Cancel</button>
                            <button className={styles.btnSave} onClick={handleAddQuestion}>Save Question</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
