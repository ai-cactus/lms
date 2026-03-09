'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

type ModalId = 'organizationActivation' | 'workerWelcome' | string;

interface ModalPriority {
  id: ModalId;
  priority: number; // Higher number = higher priority
}

interface ModalContextType {
  registerModal: (id: ModalId, priority: number) => void;
  unregisterModal: (id: ModalId) => void;
  requestOpen: (id: ModalId) => boolean; // Returns true if it can open
  closeModal: (id: ModalId) => void;
  isModalOpen: (id: ModalId) => boolean;
  dismissModal: (id: ModalId, snoozeDuration?: number) => void; // snoozeDuration in ms
  shouldShowModal: (id: ModalId) => boolean;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalId | null>(null);
  const [registeredModals, setRegisteredModals] = useState<ModalPriority[]>([]);

  // Track requests to open
  const [openRequests, setOpenRequests] = useState<Set<ModalId>>(new Set());

  const registerModal = useCallback((id: ModalId, priority: number) => {
    setRegisteredModals((prev) => {
      if (prev.find((m) => m.id === id)) return prev;
      return [...prev, { id, priority }].sort((a, b) => b.priority - a.priority);
    });
  }, []);

  const unregisterModal = useCallback(
    (id: ModalId) => {
      setRegisteredModals((prev) => prev.filter((m) => m.id !== id));
      setOpenRequests((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (activeModal === id) {
        setActiveModal(null);
      }
    },
    [activeModal],
  );

  const requestOpen = useCallback(
    (id: ModalId) => {
      // If this modal is already active, yes
      if (activeModal === id) return true;

      // Add to requests
      setOpenRequests((prev) => new Set(prev).add(id));

      return false; // Will be handled by effect
    },
    [activeModal],
  );

  const closeModal = useCallback(
    (id: ModalId) => {
      if (activeModal === id) {
        setActiveModal(null);
      }
      setOpenRequests((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [activeModal],
  );

  const dismissModal = useCallback(
    (id: ModalId, snoozeDuration: number = 0) => {
      closeModal(id);
      if (snoozeDuration === -1) {
        // Never show again
        localStorage.setItem(`modal_dismissed_${id}`, 'forever');
      } else if (snoozeDuration > 0) {
        const wakeTime = Date.now() + snoozeDuration;
        localStorage.setItem(`modal_snoozed_${id}`, wakeTime.toString());
      }
    },
    [closeModal],
  );

  const shouldShowModal = useCallback((id: ModalId) => {
    if (typeof window === 'undefined') return false;

    const dismissed = localStorage.getItem(`modal_dismissed_${id}`);
    if (dismissed === 'forever') return false;

    const snoozed = localStorage.getItem(`modal_snoozed_${id}`);
    if (snoozed) {
      if (Date.now() < parseInt(snoozed)) return false;
    }

    return true;
  }, []);

  // Effect to determine which modal should be active
  useEffect(() => {
    if (activeModal) return; // If something is open, don't interrupt (unless we add force/interrupt logic)

    // Find the highest priority requested modal
    const candidates = registeredModals.filter((m) => openRequests.has(m.id));

    if (candidates.length > 0) {
      // registeredModals is already sorted by priority desc
      const nextModal = candidates[0];
      console.log('[ModalContext] Activating modal:', nextModal.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional activation of highest priority modal
      setActiveModal(nextModal.id);
    }
  }, [activeModal, openRequests, registeredModals]);

  const isModalOpen = useCallback((id: ModalId) => activeModal === id, [activeModal]);

  return (
    <ModalContext.Provider
      value={{
        registerModal,
        unregisterModal,
        requestOpen,
        closeModal,
        isModalOpen,
        dismissModal,
        shouldShowModal,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModalContext() {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModalContext must be used within a ModalProvider');
  }
  return context;
}
