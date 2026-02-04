'use client';

import React, { useState } from 'react';
import styles from '../CourseWizard.module.css';

interface Step6QuizReviewProps {
    data: any;
}

export default function Step6QuizReview({ data }: Step6QuizReviewProps) {
    const [expandedSection, setExpandedSection] = useState<string | null>('section-1');

    const toggleSection = (id: string) => {
        setExpandedSection(expandedSection === id ? null : id);
    };

    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Review Quiz Questions</h2>
            <p className={styles.stepSubtitle}>
                Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
            </p>

            <div className={styles.quizReviewContainer}>
                {/* Header Row */}
                <div className={styles.quizHeaderRow}>
                    <div className={styles.quizHeaderLeft}>
                        <div className={styles.quizSectionTitle}>Editable quiz questions</div>
                        <div className={styles.quizSubtitle}>Subtext</div>
                    </div>
                    <button className={styles.btnRegenerate}>
                        Regenerate Quiz
                    </button>
                </div>

                {/* Flat Question List */}
                <div className={styles.questionListWrapper}>
                    {/* Question 1 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>1. Which of the following best describes the organization's mission as stated in the policy document?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>

                    {/* Question 2 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>2. According to the policy, how are individuals involved in their service planning?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>

                    {/* Question 3 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>3. Which right is explicitly protected in the policy document?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>

                    {/* Question 4 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>4. How does the organization ensure confidentiality of personal information?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>

                    {/* Question 5 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>5. What approach does the policy outline for managing risks to persons served?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>

                    {/* Question 6 */}
                    <div className={styles.questionCard}>
                        <div className={styles.questionHeader}>
                            <div className={styles.questionText}>6. Who is responsible for updating these policies?</div>
                            <button className={styles.btnEdit}>Edit</button>
                        </div>
                        <div className={styles.optionList}>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 1</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 2</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 3</div>
                            <div className={styles.optionItem}><div className={styles.radioCircle} /> Option 4</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
