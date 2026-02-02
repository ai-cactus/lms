'use client';

import React, { useState, useEffect } from 'react';
import styles from '../CourseWizard.module.css';

interface Step5ReviewProps {
    onReady: () => void; // Call when generation is done to enable parent "Next" if needed
}

export default function Step5Review({ onReady }: Step5ReviewProps) {
    const [isGenerating, setIsGenerating] = useState(true);
    const [checklistStep, setChecklistStep] = useState(0);

    const checklistItems = [
        'Analyzing policy and procedure',
        'Extract course input data',
        'Create course content and quiz',
        'Finalize all modules'
    ];

    // Animation Effect
    useEffect(() => {
        if (!isGenerating) return;

        const interval = setInterval(() => {
            setChecklistStep((prev) => {
                if (prev < checklistItems.length) {
                    return prev + 1;
                }
                clearInterval(interval);
                return prev;
            });
        }, 1500); // 1.5s per item

        return () => clearInterval(interval);
    }, [isGenerating, checklistItems.length]);

    const isComplete = checklistStep >= checklistItems.length;

    const handleContinue = () => {
        setIsGenerating(false);
        onReady(); // Notify parent that we are ready to proceed (optional depending on wizard logic)
    };

    if (isGenerating) {
        return (
            <div className={styles.stepWrapper}>
                <div className={styles.generationContainer}>
                    <h2 className={styles.stepTitle} style={{ marginBottom: 10 }}>
                        Your course is being created...
                    </h2>
                    <p className={styles.stepSubtitle}>
                        We're reviewing your document to create the course.<br />
                        You'll receive an email notification once the course is complete and ready for review.
                    </p>

                    <div className={styles.processingCard}>
                        <div className={styles.checklist}>
                            {checklistItems.map((item, index) => {
                                const isDone = checklistStep > index;
                                const isCurrent = checklistStep === index;

                                return (
                                    <div
                                        key={index}
                                        className={`${styles.checklistItem} ${isDone ? styles.completed : ''} ${isCurrent ? styles.active : ''}`}
                                    >
                                        <div className={styles.iconWrapper}>
                                            {isDone ? (
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                                    <circle cx="10" cy="10" r="10" fill="#48BB78" />
                                                    <path d="M6 10L9 13L14 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            ) : isCurrent ? (
                                                <svg className={styles.spinner} width="20" height="20" viewBox="0 0 24 24" fill="none">
                                                    <circle cx="12" cy="12" r="10" stroke="#CBD5E0" strokeWidth="3" />
                                                    <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                                                </svg>
                                            ) : (
                                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#CBD5E0' }} />
                                            )}
                                        </div>
                                        <span>{item}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {isComplete && (
                            <button className={styles.btnDashboard} onClick={handleContinue}>
                                Continue
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Review Content View
    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Review Course Content</h2>
            <p className={styles.stepSubtitle}>
                Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
            </p>

            <div className={styles.reviewContainer}>
                {/* Main Article */}
                <div className={styles.reviewMain}>
                    <div className={styles.articleTitle}>
                        10 Fundamental CARF Principles You Need to Know
                    </div>

                    <div className={styles.articleMeta}>
                        <span>Last update: Jan 12, 2024</span>
                        <span>•</span>
                        <span>10 min read</span>
                    </div>

                    <div className={styles.articleContent}>
                        <h3>Benefits of CARF Principles</h3>
                        <p>
                            As remote work has become the new normal, teams are challenged to find new ways to collaborate and hold meetings. Remote workshops are your best bet if your team members are scattered worldwide or you're limited on time and budget
                        </p>
                        <p>
                            On the flip side, during remote workshops, participants experience screen fatigue symptoms and get easily distracted. For a remote workshop to be successful and efficient, you must define the goals, prepare the agenda, decide on the participants' list, plan icebreakers, and schedule sufficient breaks.
                        </p>
                        <p>
                            One of the most important parts is finding the right tools that allow you to run a productive workshop and gather valuable insights.
                        </p>

                        <h3>How does CARF applies to Healthcare Sectors</h3>
                        <p>
                            Remote workshops are a great solution to gather all necessary people in one digital room regardless of geographical limits. However, there are also some potential pitfalls:
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ minWidth: 24, height: 24, background: '#EDF2F7', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#4A5568' }}>1</div>
                                <div>
                                    <strong>Poor choice of a digital tool and insufficient preparation:</strong> Avoid using tools unfamiliar to your team that might take more time to master. Instead, select the tools everyone on your team uses daily for communication.
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ minWidth: 24, height: 24, background: '#EDF2F7', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#4A5568' }}>2</div>
                                <div>
                                    <strong>Bad planning for workshop activities:</strong> Cutting back on warmups, icebreakers, or team-building activities because you're short on time won't result in a productive session.
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ minWidth: 24, height: 24, background: '#EDF2F7', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#4A5568' }}>3</div>
                                <div>
                                    <strong>Failure to define workshop goals and instructions:</strong> It's much harder for facilitators to have everyone's full attention and prevent participants from getting distracted during remote workshops.
                                </div>
                            </div>
                        </div>

                        <div className={styles.tipBox}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M10 6V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <circle cx="10" cy="14" r="1" fill="currentColor" />
                            </svg>
                            Tip! Test the selected tool before the workshop to discover limitations in advance.
                        </div>

                        <div className={styles.navButtons}>
                            <button className={styles.navBtn}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                                Previous Lesson
                            </button>
                            <button className={styles.navBtn}>
                                Next Lesson
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                <div className={styles.reviewSidebar}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <button className={`${styles.sidebarBtn} ${styles.sidebarBtnOutline}`}>
                            Edit
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className={`${styles.sidebarBtn} ${styles.sidebarBtnPrimary}`}>
                            View as Slides
                        </button>
                    </div>

                    <div className={styles.tocCard}>
                        <div className={styles.tocTitle}>Table of Content</div>
                        <div className={styles.tocList}>
                            <div className={styles.tocItem} style={{ color: '#4C6EF5' }}>Benefits of remote worksop</div>
                            <div className={styles.tocItem}>Challenges for remote workshops</div>
                            <div className={styles.tocItem}>What goes into a successful remote work...</div>
                            <div className={styles.tocItem}>Best practices for a remote workshop</div>
                            <div className={styles.tocItem}>Common remote workshop mistakes</div>
                            <div className={styles.tocItem}>Tools needed for remote workshops</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
