'use client';

import Link from 'next/link';
import { Lock, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface BillingGateModalProps {
  title: string;
  description: string;
  onClose: () => void;
}

export default function BillingGateModal({ title, description, onClose }: BillingGateModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[420px]"
        aria-labelledby="billing-gate-title"
        aria-describedby="billing-gate-desc"
      >
        <DialogHeader className="items-center text-center">
          {/* Illustration */}
          <div className="mb-2 flex size-24 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-12 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle id="billing-gate-title" className="text-center">
            {title}
          </DialogTitle>
          <DialogDescription id="billing-gate-desc" className="text-center">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex w-full flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/dashboard/billing">
              Go to Billing
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="outline" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
