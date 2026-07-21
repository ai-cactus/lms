'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, wrap } from 'framer-motion';
import { cn } from '@/lib/utils';

const slides = [
  {
    title: 'Audit-ready training, built from your policies',
    subtitle:
      'Turn compliance policies into structured training, track completion automatically, and keep clear records that stand up during audits.',
    image: '/images/slider_1.png',
  },
  {
    title: 'Track learning progress with full visibility',
    subtitle:
      'Monitor course completion, quiz performance, and deadlines across your team in one place, with clear insights into who needs attention.',
    image: '/images/slider_2.png',
  },
  {
    title: 'Stay ready for audits at all times',
    subtitle:
      'Automatically generate structured records of training, performance, and compliance that are ready to present whenever audits arise.',
    image: '/images/slider_3.png',
  },
  {
    title: 'Validate understanding, not just completion',
    subtitle:
      'Use quizzes and certificates to confirm that staff don’t just finish training, but truly understand and acknowledge their responsibilities.',
    image: '/images/slider_4.png',
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

  const paginate = React.useCallback(
    (newDirection: number) => {
      setPage([page + newDirection, newDirection]);
    },
    [page],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      paginate(1);
    }, 5000);
    return () => clearInterval(timer);
  }, [page, paginate]);

  return (
    <div className="relative hidden h-full lg:w-1/2 xl:w-197.75 2xl:w-1/2 overflow-hidden rounded-3xl bg-[#f7fafc] lg:block">
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
          className="absolute inset-0 size-full"
        >
          <Image
            src={slides[imageIndex].image}
            alt={slides[imageIndex].title}
            fill
            className="pointer-events-none rounded-3xl object-cover"
            priority={imageIndex === 0}
            quality={100}
            sizes="(max-width: 1024px) 0vw, 50vw"
            // Ensure pointer events drop through to motion layer
            draggable={false}
          />
        </motion.div>
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-2.5 bg-[linear-gradient(180deg,rgba(16,16,16,0)_53.5%,rgba(16,16,16,1)_100%)] p-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-auto max-w-135 text-white"
          >
            <h2 className="mb-2.5 text-[32px] font-semibold leading-[1.3]">
              {slides[imageIndex].title}
            </h2>
            <p className="text-lg font-normal leading-normal opacity-90">
              {slides[imageIndex].subtitle}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-auto flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              className={cn(
                'h-1 w-12 cursor-pointer rounded bg-white/30 transition-colors hover:bg-white/60',
                index === imageIndex && 'bg-white',
              )}
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
