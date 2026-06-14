import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface WorkerLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  planName: string;
  planLimit: number;
}

export default function WorkerLimitModal({
  isOpen,
  onClose,
  planName,
  planLimit,
}: WorkerLimitModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Worker Limit Reached</DialogTitle>
        </DialogHeader>

        <p className="text-[15px] leading-relaxed text-text-secondary">
          You have reached the maximum number of workers allowed on your current{' '}
          <strong>{planName}</strong> plan ({planLimit} seats).
        </p>

        <div className="rounded-[10px] border border-border bg-background-secondary p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Why Upgrade?</h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Add unlimited workers to your organization</li>
            <li>Access advanced administrative controls</li>
            <li>Unlock premium features and support</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              window.location.href = '/dashboard/billing';
            }}
          >
            Upgrade Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
