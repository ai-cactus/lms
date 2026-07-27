'use client';

import { useState } from 'react';
import UploadModal from './upload-modal';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export default function UploadSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="h-12 shrink-0 gap-2 rounded-xl px-[23px] text-[15.5px] font-semibold tracking-[-0.02em]"
      >
        <Plus className="size-[25px]" />
        Upload New
      </Button>
      {isOpen && <UploadModal onClose={() => setIsOpen(false)} />}
    </>
  );
}
