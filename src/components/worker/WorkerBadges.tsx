'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';

interface Badge {
    id: string;
    courseTitle: string;
    completedAt: Date | string;
    status: string; // 'Approved', 'Pending', etc.
}

interface WorkerBadgesProps {
    badges: Badge[];
}

export default function WorkerBadges({ badges }: WorkerBadgesProps) {
    if (badges.length === 0) return null;

    return (
        <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', marginTop: '32px' }}>
                <h2 className={styles.sectionTitle}>Badges Earned</h2>
                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search for courses..."
                        style={{
                            padding: '8px 12px 8px 36px',
                            borderRadius: '6px',
                            border: '1px solid #E2E8F0',
                            fontSize: '14px',
                            width: '240px'
                        }}
                    />
                    <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </div>
            </div>

            <div className={styles.tableContainer}>
                {/* Header */}
                <div className={styles.tableHeader}>
                    <div style={{ flex: 3 }}>Badges/Courses</div>
                    <div style={{ flex: 1.5 }}>Completion Date</div>
                    <div style={{ flex: 1.5 }}>Attestation</div>
                    <div style={{ flex: 1.5 }}>Status</div>
                    <div style={{ flex: 1, textAlign: 'right' }}></div>
                </div>

                {badges.map(badge => (
                    <div key={badge.id} className={styles.tableRow}>
                        <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className={styles.courseIcon} style={{ background: '#FFFBEB', color: '#D97706' }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                                </svg>
                            </div>
                            <span className={styles.courseNameText}>{badge.courseTitle}</span>
                        </div>

                        <div style={{ flex: 1.5, color: '#4A5568', fontSize: '14px' }}>
                            {new Date(badge.completedAt).toLocaleDateString()}
                        </div>

                        <div style={{ flex: 1.5 }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                background: '#EBF8FF', color: '#3182CE', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
                            }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                {badge.status === 'attested' ? 'Approved' : 'Pending'}
                            </span>
                        </div>

                        <div style={{ flex: 1.5 }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                background: '#DEF7EC', color: '#03543F', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
                            }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                Completed / 100%
                            </span>
                        </div>

                        <div style={{ flex: 1, textAlign: 'right' }}>
                            <button className={styles.verifyBtn}>Verify</button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
