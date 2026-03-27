'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select, Input } from '@/components/ui';
import { CourseWizardData } from '@/types/course';

interface Step4QuizProps {
  data: CourseWizardData;
  onChange: <K extends keyof CourseWizardData>(field: K, value: CourseWizardData[K]) => void;
}

export default function Step4Quiz({ data, onChange }: Step4QuizProps) {
  return (
    <div className={styles.stepWrapper}>
      <h2 className={styles.stepTitle}>Course Quiz</h2>
      <p className={styles.stepSubtitle}>
        Start by uploading the policy or compliance document you want to turn into a course. This
        will help you analyze and generate lessons and quizzes automatically.
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
        <div className={styles.formRow} style={{ alignItems: 'flex-start' }}>
          <label className={styles.formLabel} style={{ marginTop: '8px' }}>
            Number of Questions
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <div style={{ width: '150px' }}>
              <Input
                type="number"
                min="1"
                max="25"
                value={data.quizQuestionCount || ''}
                onChange={(e) => onChange('quizQuestionCount', e.target.value)}
                placeholder="1 - 25"
              />
            </div>
            <span style={{ color: '#E53E3E', fontSize: '13px', lineHeight: '1.4' }}>
              Adding more questions may reduce question quality. We recommend keeping questions
              concise.
            </span>
          </div>
        </div>

        {/* Difficulty */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Difficulty:</label>
          <Select
            value={data.quizDifficulty}
            onChange={(val) => onChange('quizDifficulty', val)}
            options={[
              { label: 'Easy', value: 'easy' },
              { label: 'Medium', value: 'medium' },
              { label: 'Hard', value: 'hard' },
            ]}
          />
        </div>

        {/* Estimated Duration (calculated from question count, read-only) */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Estimated Duration</label>
          <div
            style={{
              padding: '10px 14px',
              background: '#F7FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              fontSize: '14px',
              color: data.quizQuestionCount ? '#2D3748' : '#A0AEC0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {data.quizQuestionCount ? (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4C6EF5"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ~{Math.max(5, Math.round(parseInt(data.quizQuestionCount) * 1.5))} mins
                <span style={{ fontSize: '12px', color: '#718096', marginLeft: '4px' }}>
                  (based on {data.quizQuestionCount} questions)
                </span>
              </>
            ) : (
              'Set question count to see estimate'
            )}
          </div>
        </div>

        {/* Pass Mark */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Pass Mark:</label>
          <div className={styles.percentageInputWrapper}>
            <input
              type="number"
              min="0"
              max="100"
              className={styles.percentageInput}
              value={data.quizPassMark?.replace('%', '') || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (Number(val) >= 0 && Number(val) <= 100)) {
                  onChange('quizPassMark', val);
                }
              }}
              placeholder="80"
            />
            <span className={styles.percentageSuffix}>%</span>
          </div>
        </div>

        {/* Attempts */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Attempts:</label>
          <div>
            <div className={styles.attemptsInputContainer}>
              <input
                type="number"
                min="1"
                max="10"
                className={styles.attemptsInput}
                value={data.quizAttempts !== 'unlimited' ? data.quizAttempts : ''}
                onChange={(e) => onChange('quizAttempts', e.target.value)}
              />
              <span className={styles.attemptsLabel}>allowable attempts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
