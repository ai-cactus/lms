'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';

import { useRouter } from 'next/navigation';

interface Badge {
    id: string;
    courseTitle: string;
    completedAt: Date | string;
    status: string; // 'Approved', 'Pending', etc.
    score: number | null;
}

interface WorkerBadgesProps {
    badges: Badge[];
}

export default function WorkerBadges({ badges }: WorkerBadgesProps) {
    const router = useRouter();

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
                    <div key={badge.id} className={styles.tableRow} onClick={() => router.push(`/worker/courses/${badge.id}`)}>
                        <div style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '16px' }}>
                            {/* Gold Badge Icon for distinct look */}
                            <div className={styles.badgeIconWrapper}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M12 17.77V2" stroke="#B45309" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" opacity="0.5" />
                                </svg>
                            </div>
                            <span className={styles.courseNameText} style={{ fontSize: 15, fontWeight: 600 }}>{badge.courseTitle}</span>
                        </div>

                        <div style={{ flex: 1.5, color: '#4A5568', fontSize: '14px', fontWeight: 500 }}>
                            {new Date(badge.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>

                        <div style={{ flex: 1.5 }}>
                            <span className={styles.tagApproved}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                {badge.status === 'attested' ? 'Approved' : 'Pending'}
                            </span>
                        </div>

                        <div style={{ flex: 1.5 }}>
                            <span className={styles.tagCompleted}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                Completed / {badge.score || 0}%
                            </span>
                        </div>

                        <div style={{ flex: 1, textAlign: 'right' }}>
                            <button
                                className={styles.verifyBtn}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/worker/courses/${badge.id}`);
                                }}
                            >
                                Verify
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
