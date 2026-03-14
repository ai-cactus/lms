'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select, Input, Button } from '@/components/ui';

import { CourseWizardData } from '@/types/course';

interface Step3DetailsProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step3Details({ data, onChange }: Step3DetailsProps) {
  return (
    <div className={styles.stepWrapper}>
      <h2 className={styles.stepTitle}>Course Details</h2>
      <p className={styles.stepSubtitle}>
        Start by uploading the policy or compliance document you want to turn into a course. This
        will help you analyze and generate lessons and quizzes automatically.
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

        {/* Estimated Duration (AI-generated, read-only) */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Estimated Duration</label>
          <div style={{
            padding: '10px 14px',
            background: '#F7FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            fontSize: '14px',
            color: data.duration ? '#2D3748' : '#A0AEC0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            {data.duration ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4C6EF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ~{data.duration} mins
                <span style={{ fontSize: '12px', color: '#718096', marginLeft: '4px' }}>(AI estimate)</span>
              </>
            ) : (
              'Will be estimated after document analysis'
            )}
          </div>
        </div>

        {/* No of Notes / Slides */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>No of Notes / Slides</label>
          <Select
            value={data.notesCount}
            onChange={(val) => onChange('notesCount', val)}
            options={[
              { label: '10', value: '10' },
              { label: '15', value: '15' },
              { label: '20', value: '20' },
              { label: '25', value: '25' },
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
            <span
              style={{ fontSize: '12px', fontWeight: 400, color: '#718096', marginLeft: '8px' }}
            >
              (Minimum 3 required)
            </span>
          </label>
          <div className={styles.objectivesList}>
            {data.objectives.map((obj: string, index: number) => (
              <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div
                  style={{
                    width: '24px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#718096',
                    fontWeight: 600,
                  }}
                >
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newObjectives = data.objectives.filter(
                      (_: string, i: number) => i !== index,
                    );
                    onChange('objectives', newObjectives);
                  }}
                  style={{ color: '#E53E3E' }}
                  title="Remove Objective"
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                onChange('objectives', [...data.objectives, '']);
              }}
              style={{
                marginTop: '8px',
                width: '100%',
                borderStyle: 'dashed',
              }}
            >
              + Add Objective
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
