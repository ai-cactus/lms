'use client';

import React, { useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalContext } from '@/components/ui/legacy/ModalContext';

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

  const handleClose = useCallback(() => {
    if (isWelcomeMode) {
      dismissModal(modalId, 24 * 60 * 60 * 1000);
    } else {
      onClose?.();
    }
  }, [isWelcomeMode, dismissModal, modalId, onClose]);

  const isOpen = isWelcomeMode ? isModalOpen(modalId) : controlledIsOpen;

  // Auto redirect logic
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (isOpen && !hasOrganization && isWelcomeMode) {
      timeoutId = setTimeout(() => {
        handleClose();
        router.push('/onboarding');
      }, 60000); // 60 seconds
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isOpen, hasOrganization, isWelcomeMode, router, handleClose]);

  if (!isOpen) return null;

  const defaultTitle = isWelcomeMode
    ? 'Welcome to the Compliance and Training Management portal'
    : 'Organization Required';

  const defaultDesc = isWelcomeMode
    ? 'Manage facility-wide credentials, assign mandatory MBHF regulatory courses, and track real-time audit readiness to ensure your workforce stays fully compliant.'
    : "You haven't activated and created an organization yet. Click here to start activating your account to access this feature.";

  const defaultAction = 'Activate your account';

  return (
    <Dialog
      open={!!isOpen}
      onOpenChange={(open) => {
        // Force user to choose an action in welcome mode
        if (!open && !isWelcomeMode) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={!isWelcomeMode}
        className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onInteractOutside={(e) => {
          if (isWelcomeMode) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isWelcomeMode) e.preventDefault();
        }}
      >
        <div className="flex w-full flex-col overflow-y-auto md:h-[500px] md:flex-row md:overflow-y-visible">
          {/* Content Section */}
          <div className="flex flex-1 flex-col justify-center px-5 py-6 md:p-12">
            <div className="mb-5 md:mb-6">
              <Logo variant="blue" size="md" />
            </div>

            <DialogTitle className="mb-3 text-xl font-bold leading-tight text-[#111827] md:mb-4 md:text-[30px]">
              {title || defaultTitle}
            </DialogTitle>

            <p className="mb-6 text-[15px] leading-relaxed text-[#4b5563] md:mb-8 md:text-base">
              {description || defaultDesc}
            </p>

            <div className="flex w-full flex-col items-stretch gap-3 md:items-start md:gap-4">
              <Button
                onClick={() => router.push('/onboarding')}
                className="w-full rounded-full md:w-auto"
              >
                {actionLabel || defaultAction}
              </Button>
            </div>
          </div>

          {/* Visual Section - Image Right */}
          <div className="relative hidden min-h-[400px] w-full md:block md:w-1/2">
            <Image
              src="/images/onboarding-welcome.png"
              alt="Healthcare Professional Working"
              fill
              className="object-cover"
              priority
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
