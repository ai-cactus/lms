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
              Questions generated may be fewer than requested if the material does not support the
              full count. <br />
              Estimated supported questions: 4–6
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

        {/* Question Type */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Question Type:</label>
          <Select
            value={data.quizQuestionType}
            onChange={(val) => onChange('quizQuestionType', val)}
            options={[
              { label: 'Multiple Choice', value: 'multiple_choice' },
              { label: 'True / False', value: 'true_false' },
              { label: 'Mixed', value: 'mixed' },
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
              { label: '~45 mins', value: '45' },
            ]}
          />
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
          <label
            className={styles.formLabel}
            style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
          >
            Attempts
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={data.quizAttempts === 'unlimited'}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange('quizAttempts', 'unlimited');
                  } else {
                    onChange('quizAttempts', '1');
                  }
                }}
              />
              <span className={styles.slider}></span>
            </label>
            <span className={styles.toggleLabel}>Unlimited</span>
          </label>
          <div>
            {data.quizAttempts !== 'unlimited' && (
              <div className={styles.attemptsInputContainer}>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className={styles.attemptsInput}
                  value={data.quizAttempts}
                  onChange={(e) => onChange('quizAttempts', e.target.value)}
                />
                <span className={styles.attemptsLabel}>allowable attempts</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
