'use client';

import { useState } from 'react';
import UploadModal from './upload-modal';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export default function UploadSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="size-5" />
        Upload New
      </Button>
      {isOpen && <UploadModal onClose={() => setIsOpen(false)} />}
    </>
  );
}
