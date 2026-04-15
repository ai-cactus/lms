'use client';

import React from 'react';
import styles from './FeatureSection.module.css';

export default function FeatureSection() {
  return (
    <section className={styles.featuresSection} id="features">
      <div className={styles.featuresHeader}>
        <h2 className={styles.featuresTitle}>
          Built for behavioral health
          <br />
          compliance workflows.
        </h2>
        <p className={styles.featuresSubtitle}>
          Feel confident knowing your practice is fully ready for CARF and state inspections.
        </p>
      </div>

      <div className={styles.featuresGrid}>
        {/* Feature 1 */}
        <div className={styles.featureCard}>
          <div className={styles.featureIconWrapper}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M16 11V7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7V11M5 11H19V21H5V11Z"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 16L11.5 17.5L14 14.5"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className={styles.featureDivider}></div>
          <h3 className={styles.featureCardTitle}>
            Policy-Linked
            <br />
            Training
            <br />
            Documentation
          </h3>
          <p className={styles.featureCardDescription}>
            Builds every training module directly from your clinic&apos;s own policies with a
            permanent link to the source.
          </p>
        </div>

        {/* Feature 2 */}
        <div className={styles.featureCard}>
          <div className={styles.featureIconWrapper}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="9" stroke="#101010" strokeWidth="2.5" />
              <path
                d="M12 8V12L15 15"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className={styles.featureDivider}></div>
          <h3 className={styles.featureCardTitle}>
            Timestamped
            <br />
            Completion Records
          </h3>
          <p className={styles.featureCardDescription}>
            Logs every completion with exact date, time, and staff name for instant surveyor
            verification.
          </p>
        </div>

        {/* Feature 3 */}
        <div className={styles.featureCard}>
          <div className={styles.featureIconWrapper}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 3L4 6V11C4 16.55 7.42 21.72 12 23C16.58 21.72 20 16.55 20 11V6L12 3Z"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z"
                fill="#101010"
              />
              <path
                d="M7.74996 17.5C7.74996 15.0147 9.65173 13 12 13C14.3483 13 16.25 15.0147 16.25 17.5"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className={styles.featureDivider}></div>
          <h3 className={styles.featureCardTitle}>
            Role-Based Staff
            <br />
            Assignments
          </h3>
          <p className={styles.featureCardDescription}>
            Assign trainings by role, department, or individual in one click with no spreadsheets or
            chasing.
          </p>
        </div>

        {/* Feature 4 */}
        <div className={styles.featureCard}>
          <div className={styles.featureIconWrapper}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M20 16V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V16M12 16V3M12 3L16 7.5M12 3L8 7.5"
                stroke="#101010"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className={styles.featureDivider}></div>
          <h3 className={styles.featureCardTitle}>
            Exportable
            <br />
            Inspection
            <br />
            Documentation
          </h3>
          <p className={styles.featureCardDescription}>
            Generate a full auditor-ready report in seconds with policies, timestamps, and results,
            downloadable instantly.
          </p>
        </div>
      </div>

      {/* CARF Pill Badge */}
      <div className={styles.carfPill}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
            fill="#1e1e1e"
          />
          <path
            d="M8 12L11 15L16 9"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Preparing facilities for CARF and state inspections.
      </div>
    </section>
  );
}
