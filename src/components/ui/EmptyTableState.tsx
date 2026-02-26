'use client';

import React from 'react';

interface EmptyTableStateProps {
    message?: string;
    subMessage?: string;
    colSpan?: number;
    /** If true, wraps in a <tr><td> for use inside <tbody> */
    asTableRow?: boolean;
}

/**
 * A reusable empty state component with a friendly illustration.
 * Can be used inside tables (asTableRow=true) or standalone.
 */
export default function EmptyTableState({
    message = 'No items found.',
    subMessage,
    colSpan = 4,
    asTableRow = false,
}: EmptyTableStateProps) {
    const content = (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            gap: '16px',
        }}>
            {/* Empty state illustration */}
            <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Folder base */}
                <rect x="15" y="30" width="90" height="58" rx="6" fill="#EDF2F7" stroke="#CBD5E0" strokeWidth="1.5" />
                {/* Folder tab */}
                <path d="M15 36C15 32.6863 17.6863 30 21 30H42L48 22H21C17.6863 22 15 24.6863 15 28V36Z" fill="#E2E8F0" stroke="#CBD5E0" strokeWidth="1.5" />
                {/* Document 1 */}
                <rect x="38" y="14" width="32" height="40" rx="3" fill="white" stroke="#CBD5E0" strokeWidth="1.5" />
                <line x1="44" y1="24" x2="64" y2="24" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="44" y1="30" x2="58" y2="30" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="44" y1="36" x2="62" y2="36" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                <line x1="44" y1="42" x2="54" y2="42" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
                {/* Magnifying glass */}
                <circle cx="88" cy="28" r="14" fill="white" stroke="#4C6EF5" strokeWidth="2" opacity="0.8" />
                <circle cx="88" cy="28" r="8" stroke="#4C6EF5" strokeWidth="1.5" opacity="0.5" />
                <line x1="98" y1="38" x2="104" y2="46" stroke="#4C6EF5" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
                {/* Small decorative dots */}
                <circle cx="28" cy="75" r="2" fill="#CBD5E0" />
                <circle cx="92" cy="75" r="2" fill="#CBD5E0" />
                <circle cx="60" cy="80" r="1.5" fill="#E2E8F0" />
            </svg>

            <div style={{ textAlign: 'center' }}>
                <p style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#4A5568',
                    margin: '0 0 4px 0',
                }}>
                    {message}
                </p>
                {subMessage && (
                    <p style={{
                        fontSize: '13px',
                        color: '#A0AEC0',
                        margin: 0,
                    }}>
                        {subMessage}
                    </p>
                )}
            </div>
        </div>
    );

    if (asTableRow) {
        return (
            <tr>
                <td colSpan={colSpan} style={{ border: 'none' }}>
                    {content}
                </td>
            </tr>
        );
    }

    return content;
}
