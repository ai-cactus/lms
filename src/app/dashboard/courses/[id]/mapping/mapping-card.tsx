'use client';

import { useState } from 'react';
import { saveMapping } from '@/app/actions/mapping';
import styles from './mapping.module.css';

export default function MappingCard({ documentVersionId, suggestion }: { documentVersionId: string, suggestion: any }) {
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    async function handleSave() {
        setStatus('saving');
        await saveMapping(documentVersionId, suggestion.standardId, suggestion.snippet, "Auto-mapped");
        setStatus('saved');
    }

    return (
        <div className={styles.snippetCard}>
            <strong>{suggestion.standardId}</strong>
            <p className={styles.snippetText}>{suggestion.snippet}</p>
            <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-green-600">Match: {Math.round(suggestion.confidence * 100)}%</span>
                <button
                    onClick={handleSave}
                    disabled={status !== 'idle'}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-50"
                >
                    {status === 'saved' ? 'Saved' : 'Approve'}
                </button>
            </div>
        </div>
    );
}
