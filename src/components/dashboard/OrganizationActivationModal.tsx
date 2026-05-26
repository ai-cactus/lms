'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from './OrganizationActivationModal.module.css';
import { Logo, Modal, Button } from '@/components/ui';
import { useModalContext } from '@/components/ui/ModalContext';

interface OrganizationActivationModalProps {
  hasOrganization: boolean;
  mode?: 'welcome' | 'feature_gate'; // 'welcome' for initial onboarding, 'controlled' for external control
  isOpen?: boolean; // For controlled mode
  onClose?: () => void; // For controlled mode
  title?: string;
  description?: string;
  actionLabel?: string;
}

export default function OrganizationActivationModal({
  hasOrganization,
  mode = 'welcome',
  isOpen: controlledIsOpen,
  onClose,
  title,
  description,
  actionLabel,
}: OrganizationActivationModalProps) {
  const router = useRouter();
  const {
    registerModal,
    unregisterModal,
    requestOpen,
    isModalOpen,
    dismissModal,
    shouldShowModal,
  } = useModalContext();
  const modalId = 'organizationActivation';

  const isWelcomeMode = mode === 'welcome';

  // Internal state for controlled mode if needed, but mostly relying on context for welcome mode

  useEffect(() => {
    if (isWelcomeMode) {
      // Register with high priority (10)
      registerModal(modalId, 10);

      // Check if we should show it
      if (!hasOrganization && shouldShowModal(modalId)) {
        requestOpen(modalId);
      }
    }

    return () => {
      if (isWelcomeMode) {
        unregisterModal(modalId);
      }
    };
  }, [
    isWelcomeMode,
    hasOrganization,
    registerModal,
    unregisterModal,
    requestOpen,
    shouldShowModal,
    modalId,
  ]);

  const handleClose = () => {
    if (isWelcomeMode) {
      // "Skip for now" - snooze for 24 hours
      dismissModal(modalId, 24 * 60 * 60 * 1000);
    } else {
      onClose?.();
    }
  };

  const isOpen = isWelcomeMode ? isModalOpen(modalId) : controlledIsOpen;

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isWelcomeMode && !hasOrganization && isOpen) {
      timer = setTimeout(() => {
        router.push('/onboarding');
      }, 8000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, isWelcomeMode, hasOrganization, router]);

  if (!isOpen) return null;

  const defaultTitle = isWelcomeMode
    ? 'Welcome to the Compliance and Training Management portal'
    : 'Organization Required';

  const defaultDesc = isWelcomeMode
    ? 'Manage facility-wide credentials, assign mandatory MBHF regulatory courses, and track real-time audit readiness to ensure your workforce stays fully compliant.'
    : "You haven't activated and created an organization yet. Click here to start activating your account to access this feature.";

  const defaultAction = 'Activate your account';

  return (
    <Modal
      isOpen={!!isOpen}
      onClose={handleClose}
      size="xl"
      className={styles.modalParams}
      contentClassName={styles.modalContentParams}
      preventClose={isWelcomeMode} // Force user to choose an action
      showCloseButton={!isWelcomeMode}
    >
      <div className={styles.container}>
        {/* Content Section */}
        <div className={styles.content}>
          <div className={styles.logoWrapper}>
            <Logo variant="blue" size="md" />
          </div>

          <h2 className={styles.title}>{title || defaultTitle}</h2>

          <p className={styles.description}>{description || defaultDesc}</p>

          <div className={styles.actions}>
            <Button
              variant="primary"
              size="md"
              pill
              onClick={() => router.push('/onboarding')}
              style={{ width: '100%' }}
            >
              {actionLabel || defaultAction}
            </Button>
            {/* <Button variant="ghost" size="md" onClick={handleClose}>
              Skip for now
            </Button> */}
          </div>
        </div>

        {/* Visual Section - Image Right */}
        <div className={styles.imageSection}>
          <Image
            src="/images/onboarding-welcome.png"
            alt="Healthcare Professional Working"
            fill
            className={styles.image}
            priority
          />
        </div>
      </div>
    </Modal>
  );
}
