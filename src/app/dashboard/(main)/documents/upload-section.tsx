'use client';

import { useState } from 'react';
import UploadModal from './upload-modal';
import styles from './page.module.css';
import { Button } from '@/components/ui';

export default function UploadSection() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button onClick={() => setIsOpen(true)} className={styles.uploadBtn}>
                + Upload Document
            </Button>
            {isOpen && <UploadModal onClose={() => setIsOpen(false)} />}
        </>
    );
}
