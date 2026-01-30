import React from 'react';
import styles from './page.module.css';
import { Button } from '@/components/ui';
import { createClient } from '@/utils/supabase/server';

export default async function DashboardPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch profile role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user?.id)
        .single();

    const role = profile?.role;

    if (role === 'worker') {
        return (
            <div className={styles.container} style={{ justifyContent: 'center', alignItems: 'center' }}>
                <h1 className={styles.title}>Welcome back!</h1>
                <p className={styles.subtitle}>Your dashboard is coming soon.</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Upload Your Policy</h1>
                <p className={styles.subtitle}>
                    Upload your document here to get started! Accepted formats include PDFand DOCX.
                </p>
            </div>

            <div className={styles.uploadArea}>
                {/* Note: Drag events are client-side. We might need a client component for the area, 
                or just keep it static for now as this is server component.
                For full drag-drop, we should extract UploadArea to a client component.
                For now, rendering static HTML.
            */}
                <div className={styles.uploadContent}>
                    <div className={styles.iconWrapper}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                    </div>

                    <h3 className={styles.uploadTitle}>Drag & drop your files here</h3>
                    <p className={styles.uploadMeta}>file type: PDF, DOCX (max. 100MB)</p>

                    <div className={styles.divider}>
                        <span>or</span>
                    </div>

                    <Button variant="primary" size="md" className={styles.selectButton}>
                        SELECT FILE
                    </Button>
                </div>
            </div>

            <div className={styles.footer}>
                <button className={styles.helpLink}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    Help Center
                </button>

                <div className={styles.actions}>
                    <button className={styles.cancelButton}>Cancel</button>
                    <button className={styles.previewButton} disabled>Preview</button>
                </div>
            </div>
        </div>
    );
}
