'use client';

import { useState, useEffect } from 'react';
import styles from './ClientTypingEffect.module.css';

const words = ['documentation.', 'record.'];

export default function ClientTypingEffect() {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState('documentation.');
  const [isDeleting, setIsDeleting] = useState(true);
  const [isPaused, setIsPaused] = useState(true);

  useEffect(() => {
    // Initial pause before we start deleting "documentation."
    const initialTimer = setTimeout(() => {
      setIsPaused(false);
    }, 2000);
    return () => clearTimeout(initialTimer);
  }, []);

  useEffect(() => {
    if (isPaused) return;

    let timer: NodeJS.Timeout;

    const type = () => {
      const fullText = words[currentWordIndex];

      if (isDeleting) {
        setCurrentText((prev) => fullText.substring(0, prev.length - 1));
      } else {
        setCurrentText((prev) => fullText.substring(0, prev.length + 1));
      }

      let typeSpeed = isDeleting ? 90 : 180;

      if (!isDeleting && currentText === fullText) {
        typeSpeed = 2500; // Pause at the end of the word
        setIsDeleting(true);
      } else if (isDeleting && currentText === '') {
        setIsDeleting(false);
        setCurrentWordIndex((prev) => (prev + 1) % words.length);
        typeSpeed = 700; // Pause before starting the next word
      }

      timer = setTimeout(type, typeSpeed);
    };

    timer = setTimeout(type, isDeleting ? 90 : 180);

    return () => clearTimeout(timer);
  }, [currentText, isDeleting, currentWordIndex, isPaused]);

  return (
    <span className={styles.highlightWrapper}>
      <span className={styles.cursorLine}></span>
      <span>{currentText}</span>
    </span>
  );
}
