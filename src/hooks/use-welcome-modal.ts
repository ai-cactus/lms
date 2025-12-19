"use client";

import { useState, useEffect } from "react";

export function useWelcomeModal() {
  const [isOpen, setIsOpen] = useState(() => {
    // Check if user has seen the welcome modal before
    const hasSeenWelcome = localStorage.getItem("theraptly-welcome-seen");
    return !hasSeenWelcome;
  });

  const closeModal = () => {
    setIsOpen(false);
    localStorage.setItem("theraptly-welcome-seen", "true");
  };

  const openModal = () => {
    setIsOpen(true);
  };

  return {
    isOpen,
    closeModal,
    openModal,
  };
}
