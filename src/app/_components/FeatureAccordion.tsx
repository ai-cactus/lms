'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './FeatureAccordion.module.css';

const accordionData = [
  {
    id: 'policies',
    title: 'Policies',
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="6" cy="12" r="4" />
        <path d="M10 12h11M17 12v3M20 12v3" />
      </svg>
    ),
    content: 'Control user access and simplify logins for your clinical and compliance teams.',
  },
  {
    id: 'training',
    title: 'Training',
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="5" />
        <path d="M20 21a8 8 0 1 0-16 0" />
      </svg>
    ),
    content:
      'Deliver role-based assigned trainings tailored specifically to behavioral health environments.',
  },
  {
    id: 'records',
    title: 'Completion records',
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="16" y="5" width="4" height="15" />
        <rect x="9" y="11" width="4" height="9" />
        <rect x="2" y="15" width="4" height="5" />
      </svg>
    ),
    content:
      'Automatically track and timestamp completion data to instantly verify staff compliance.',
  },
  {
    id: 'docs',
    title: 'Inspection documentation',
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    content: 'Generate audit-ready reports matching state and CARF requirements with one click.',
  },
];

export default function FeatureAccordion() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.leftCol}>
          <h2 className={styles.title}>STAFF TRAINING & DOCUMENTATION</h2>
          <p className={styles.subtitle}>
            When inspectors ask for documentation, you already have it.
          </p>
        </div>

        <div className={styles.rightCol}>
          <div className={styles.accordionGroup}>
            {accordionData.map((item, index) => {
              const isOpen = index === openIndex;
              return (
                <div
                  key={item.id}
                  className={`${styles.accordionItem} ${isOpen ? styles.open : ''}`}
                >
                  <button
                    className={styles.accordionHeader}
                    onClick={() => setOpenIndex(index)}
                    aria-expanded={isOpen}
                  >
                    <div className={styles.headerLeft}>
                      <span className={styles.icon}>{item.icon}</span>
                      <span className={styles.headerTitle}>{item.title}</span>
                    </div>
                    <span className={styles.chevron}>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.3s ease',
                        }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  <div className={styles.accordionContentWrapper}>
                    <div className={styles.accordionContent}>
                      <div className={styles.accordionContentInner}>{item.content}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <Link href="/signup" className={styles.btnPrimary}>
          Start for free &rarr;
        </Link>
        <Link href="/request-demo" className={styles.btnSecondary}>
          Request Demo
        </Link>
      </div>
    </section>
  );
}
