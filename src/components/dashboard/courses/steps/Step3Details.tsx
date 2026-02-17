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



                <hr style={{ margin: '40px 0', border: 'none', borderTop: '1px solid #EDF2F7' }} />

                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#1A202C' }}>
                    Learning Objectives
                </h3>

                {/* Learning Objectives */}
                <div className={`${styles.formRow} ${styles.formRowTop}`}>
                    <label className={`${styles.formLabel} ${styles.formLabelTop}`}>
                        Objectives
                        <span style={{ fontSize: '12px', fontWeight: 400, color: '#718096', marginLeft: '8px' }}>
                            (Minimum 3 required)
                        </span>
                    </label>
                    <div className={styles.objectivesList}>
                        {data.objectives.map((obj: string, index: number) => (
                            <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                <div style={{
                                    width: '24px',
                                    height: '40px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#718096',
                                    fontWeight: 600
                                }}>
                                    {index + 1}.
                                </div>
                                <Input
                                    value={obj}
                                    onChange={(e) => {
                                        const newObjectives = [...data.objectives];
                                        newObjectives[index] = e.target.value;
                                        onChange('objectives', newObjectives);
                                    }}
                                    placeholder={`Objective ${index + 1}`}
                                />
                                <button
                                    onClick={() => {
                                        const newObjectives = data.objectives.filter((_: any, i: number) => i !== index);
                                        onChange('objectives', newObjectives);
                                    }}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#E53E3E',
                                        cursor: 'pointer',
                                        padding: '0 8px'
                                    }}
                                    title="Remove Objective"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => {
                                onChange('objectives', [...data.objectives, '']);
                            }}
                            style={{
                                marginTop: '8px',
                                background: 'transparent',
                                border: '1px dashed #CBD5E0',
                                borderRadius: '6px',
                                padding: '8px 16px',
                                color: '#4A5568',
                                cursor: 'pointer',
                                width: '100%',
                                fontSize: '14px',
                                fontWeight: 500
                            }}
                        >
                            + Add Objective
                        </button>
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
