'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select, Input } from '@/components/ui';

interface Step3DetailsProps {
    data: any;
    onChange: (field: string, value: any) => void;
}

export default function Step3Details({ data, onChange }: Step3DetailsProps) {
    return (
        <div className={styles.stepWrapper}>
            <h2 className={styles.stepTitle}>Course Details</h2>
            <p className={styles.stepSubtitle}>
                Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
            </p>

            <div className={styles.scrollableStepContent}>
                {/* Course Title */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Course Title</label>
                    <Input
                        value={data.title}
                        onChange={(e) => onChange('title', e.target.value)}
                        placeholder="Enter course title"
                    />
                </div>

                {/* Short Description */}
                <div className={`${styles.formRow} ${styles.formRowTop}`}>
                    <label className={`${styles.formLabel} ${styles.formLabelTop}`}>Short Description</label>
                    <textarea
                        className={styles.textarea}
                        value={data.description}
                        onChange={(e) => onChange('description', e.target.value)}
                        placeholder="Enter short description"
                    />
                </div>

                {/* Category */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Category</label>
                    <Select
                        value={data.category}
                        onChange={(val) => onChange('category', val)}
                        options={[
                            { label: 'Cybersecurity and Technology', value: 'cybersecurity' },
                            { label: 'Health and Safety', value: 'health_safety' }
                        ]}
                    />
                </div>

                {/* Difficulty Level */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Difficulty Level</label>
                    <Select
                        value={data.difficulty}
                        onChange={(val) => onChange('difficulty', val)}
                        options={[
                            { label: 'Beginner', value: 'beginner' },
                            { label: 'Moderate', value: 'moderate' },
                            { label: 'Advanced', value: 'advanced' }
                        ]}
                    />
                </div>

                {/* Estimated Duration */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Estimated Duration</label>
                    <Select
                        value={data.duration}
                        onChange={(val) => onChange('duration', val)}
                        options={[
                            { label: '~30 mins', value: '30' },
                            { label: '~60 mins', value: '60' },
                            { label: '~90 mins', value: '90' }
                        ]}
                    />
                </div>

                {/* Content Type */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Content Type</label>
                    <Select
                        value={data.contentType}
                        onChange={(val) => onChange('contentType', val)}
                        options={[
                            { label: 'Notes', value: 'notes' },
                            { label: 'Video', value: 'video' },
                            { label: 'Hybrid', value: 'hybrid' }
                        ]}
                    />
                </div>

                {/* No of Notes / Slides */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>No of Notes / Slides</label>
                    <Select
                        value={data.notesCount}
                        onChange={(val) => onChange('notesCount', val)}
                        options={[
                            { label: '5', value: '5' },
                            { label: '10', value: '10' },
                            { label: '15', value: '15' }
                        ]}
                    />
                </div>

                {/* Deadline */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>Deadline to Complete Course</label>
                    <Select
                        value={data.deadline}
                        onChange={(val) => onChange('deadline', val)}
                        options={[
                            { label: '15 days', value: '15' },
                            { label: '30 days', value: '30' },
                            { label: '45 days', value: '45' }
                        ]}
                    />
                </div>

                <hr style={{ margin: '40px 0', border: 'none', borderTop: '1px solid #EDF2F7' }} />

                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#1A202C' }}>
                    Learning Objectives
                </h3>

                {/* Learning Objectives */}
                <div className={`${styles.formRow} ${styles.formRowTop}`}>
                    <label className={`${styles.formLabel} ${styles.formLabelTop}`}>Objectives</label>
                    <div className={styles.objectivesList}>
                        {data.objectives.map((obj: string, index: number) => (
                            <div key={index} className={styles.objectiveInput}>
                                {index + 1}. {obj}
                            </div>
                        ))}
                    </div>
                </div>

                <h3 style={{ fontSize: '20px', fontWeight: 700, margin: '40px 0 24px', color: '#1A202C' }}>
                    Compliance Mapping
                </h3>

                {/* Compliance Mapping */}
                <div className={styles.formRow}>
                    <label className={styles.formLabel}>CARF Section</label>
                    <div className={styles.readOnlyBox}>
                        Standard 1.J.5.a.-b.
                    </div>
                </div>
            </div>
        </div>
    );
}
