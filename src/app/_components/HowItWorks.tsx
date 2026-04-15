'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import styles from './HowItWorks.module.css';

const steps = [
  {
    id: 1,
    image: '/images/carousel-a.png',
    alt: 'Upload Training Documents Screen',
    title: 'Upload Your Policy',
    description:
      'Upload your policy or procedure, and Theraptly converts it into a ready-to-use training module with lessons and quizzes.',
  },
  {
    id: 2,
    image: '/images/carousel-b.png',
    alt: 'Training Principle Overview Screen',
    title: 'Assign & Train Your Team',
    description:
      'Assign courses to staff based on roles, track progress, and ensure everyone completes required training on time.',
  },
  {
    id: 3,
    image: '/images/carousel-c.png',
    alt: 'Assigned Courses Dashboard Screen',
    title: 'Track Performance & Be Audit-ready',
    description:
      'Get real-time insights on completion rates, quiz results, and CARF alignment—all in one dashboard.',
  },
];

const AUTO_SCROLL_INTERVAL = 3500; // ms

export default function HowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % steps.length);
    }, AUTO_SCROLL_INTERVAL);
  }, []);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resetTimer]);

  const handleDotClick = (index: number) => {
    goTo(index);
    resetTimer(); // Reset auto-scroll on manual interaction
  };

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        {/* Static left column */}
        <div className={styles.header}>
          <h2 className={styles.title}>How it works</h2>
          <p className={styles.subtitle}>Just follow these easy steps</p>

          {/* Step text list — updates with active step */}
          <div className={styles.stepTextList}>
            {steps.map((step, i) => (
              <button
                key={step.id}
                className={`${styles.stepText} ${i === activeIndex ? styles.stepTextActive : ''}`}
                onClick={() => handleDotClick(i)}
                aria-current={i === activeIndex ? 'step' : undefined}
              >
                <span className={styles.stepNum}>{step.id}</span>
                <div>
                  <p className={styles.stepTextTitle}>{step.title}</p>
                  <p className={styles.stepTextDesc}>{step.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Dot indicators */}
          <div className={styles.dots}>
            {steps.map((step, i) => (
              <button
                key={step.id}
                className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`}
                onClick={() => handleDotClick(i)}
                aria-label={`Go to step ${step.id}`}
              />
            ))}
          </div>
        </div>

        {/* Scrolling right column */}
        <div className={styles.carouselPane}>
          <div
            className={styles.carouselTrack}
            style={{
              width: `${steps.length * 100}%`,
              transform: `translateX(-${activeIndex * (100 / steps.length)}%)`,
            }}
          >
            {steps.map((step) => (
              <div className={styles.slide} key={step.id}>
                <div className={styles.phoneFrame}>
                  <Image
                    src={step.image}
                    alt={step.alt}
                    width={320}
                    height={480}
                    className={styles.phoneImage}
                    priority={step.id === 1}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
