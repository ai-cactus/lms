'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, wrap } from 'framer-motion';
import styles from './AuthHeroSlider.module.css';

const slides = [
  {
    title: 'Audit-ready training, built from your policies',
    subtitle:
      'Turn compliance policies into structured training, track completion automatically, and keep clear records that stand up during audits.',
    image: '/images/login-bg.png',
  },
  {
    title: 'Track learning progress with full visibility',
    subtitle:
      'Monitor course completion, quiz performance, and deadlines across your team in one place, with clear insights into who needs attention.',
    image: '/images/login-bg.png', // Temporary placeholder until real Figma exports
  },
  {
    title: 'Validate understanding, not just completion',
    subtitle:
      'Use quizzes and attestations to confirm that staff don’t just finish training, but truly understand and acknowledge their responsibilities.',
    image: '/images/login-bg.png',
  },
  {
    title: 'Stay ready for audits at all times',
    subtitle:
      'Automatically generate structured records of training, performance, and compliance that are ready to present whenever audits arise.',
    image: '/images/login-bg.png',
  },
];

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 1000 : -1000,
    opacity: 0,
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 1000 : -1000,
    opacity: 0,
  }),
};

const swipeConfidenceThreshold = 10000;
const swipePower = (offset: number, velocity: number) => {
  return Math.abs(offset) * velocity;
};

export default function AuthHeroSlider() {
  const [[page, direction], setPage] = useState([0, 0]);

  // We only have 4 images, but we paginate them absolutely (ie 1, 2, 3, 4, 5...) and
  // then wrap that to 0-3 to find our image index in the array. By passing an
  // absolute page index as the `custom` prop to our variants, they can
  // calculate what direction to animate in.
  const imageIndex = wrap(0, slides.length, page);

  const paginate = (newDirection: number) => {
    setPage([page + newDirection, newDirection]);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      paginate(1);
    }, 5000);
    return () => clearInterval(timer);
  }, [page, paginate]);

  return (
    <div className={styles.heroSection}>
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={page}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: 'spring', stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 },
          }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={1}
          onDragEnd={(e, { offset, velocity }) => {
            const swipe = swipePower(offset.x, velocity.x);

            if (swipe < -swipeConfidenceThreshold) {
              paginate(1);
            } else if (swipe > swipeConfidenceThreshold) {
              paginate(-1);
            }
          }}
          className={styles.motionContainer}
        >
          <Image
            src={slides[imageIndex].image}
            alt={slides[imageIndex].title}
            fill
            className={styles.heroImage}
            priority={imageIndex === 0}
            quality={100}
            sizes="(max-width: 1024px) 0vw, 50vw"
            // Ensure pointer events drop through to motion layer
            style={{ pointerEvents: 'none' }}
          />
        </motion.div>
      </AnimatePresence>

      {/* Overlay Content */}
      <div className={styles.heroOverlay}>
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className={styles.heroTextContent}
          >
            <h2 className={styles.heroTitle}>{slides[imageIndex].title}</h2>
            <p className={styles.heroSubtitle}>{slides[imageIndex].subtitle}</p>
          </motion.div>
        </AnimatePresence>

        <div className={styles.progressBarContainer}>
          {slides.map((_, index) => (
            <button
              key={index}
              className={`${styles.progressSegment} ${index === imageIndex ? styles.active : ''}`}
              onClick={() => {
                const newDirection = index > imageIndex ? 1 : -1;
                setPage([index, newDirection]);
              }}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
