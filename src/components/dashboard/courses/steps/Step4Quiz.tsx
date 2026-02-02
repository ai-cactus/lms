'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select, Input } from '@/components/ui';

interface Step4QuizProps {
    data: any;
    onChange: (field: string, value: any) => void;
}

export default function Step4Quiz({ data, onChange }: Step4QuizProps) {
    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Course Quiz</h2>
            <p className={styles.stepSubtitle}>
                Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
            </p>

            <div className={styles.scrollableStepContent}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', color: '#1A202C' }}>
                    Course Quiz
                </h3>

                {/* Quiz Title */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Quiz Title</label>
                    <Input
                        value={data.quizTitle}
                        onChange={(e) => onChange('quizTitle', e.target.value)}
                        placeholder="Enter quiz title"
                    />
                </div>

                {/* Number of Questions */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Number of Questions:</label>
                    <Select
                        value={data.quizQuestionCount}
                        onChange={(val) => onChange('quizQuestionCount', val)}
                        options={[
                            { label: '5', value: '5' },
                            { label: '10', value: '10' },
                            { label: '15', value: '15' },
                            { label: '20', value: '20' }
                        ]}
                    />
                </div>

                {/* Difficulty */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Difficulty:</label>
                    <Select
                        value={data.quizDifficulty}
                        onChange={(val) => onChange('quizDifficulty', val)}
                        options={[
                            { label: 'Beginner', value: 'beginner' },
                            { label: 'Moderate', value: 'moderate' },
                            { label: 'Advanced', value: 'advanced' }
                        ]}
                    />
                </div>

                {/* Question Type */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Question Type:</label>
                    <Select
                        value={data.quizQuestionType}
                        onChange={(val) => onChange('quizQuestionType', val)}
                        options={[
                            { label: 'Multiple Choice', value: 'multiple_choice' },
                            { label: 'True / False', value: 'true_false' },
                            { label: 'Mixed', value: 'mixed' }
                        ]}
                    />
                </div>

                {/* Estimated Duration */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Estimated Duration</label>
                    <Select
                        value={data.quizDuration}
                        onChange={(val) => onChange('quizDuration', val)}
                        options={[
                            { label: '~15 mins', value: '15' },
                            { label: '~30 mins', value: '30' },
                            { label: '~45 mins', value: '45' }
                        ]}
                    />
                </div>

                {/* Pass Mark */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Pass Mark:</label>
                    <Input
                        value={data.quizPassMark}
                        onChange={(e) => onChange('quizPassMark', e.target.value)}
                        placeholder="e.g. 80%"
                    />
                </div>

                {/* Attempts */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Attempts</label>
                    <Select
                        value={data.quizAttempts}
                        onChange={(val) => onChange('quizAttempts', val)}
                        options={[
                            { label: '1', value: '1' },
                            { label: '2', value: '2' },
                            { label: '3', value: '3' },
                            { label: 'Unlimited', value: 'unlimited' }
                        ]}
                    />
                </div>
            </div>
        </div>
    );
}
