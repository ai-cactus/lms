'use client';

import { useState } from 'react';
import UploadModal from './upload-modal';
import styles from './page.module.css';

export default function UploadSection() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button onClick={() => setIsOpen(true)} className={styles.uploadBtn}>
                + Upload Document
            </button>
            {isOpen && <UploadModal onClose={() => setIsOpen(false)} />}
        </>
    );
}
