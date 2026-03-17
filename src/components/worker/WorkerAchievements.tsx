'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';

interface WorkerAchievementsProps {
  badgeCount: number;
}

export default function WorkerAchievements({ badgeCount }: WorkerAchievementsProps) {
  return (
    <section className={styles.achievementsSection}>
      <h2 className={styles.sectionTitle}>Courses Completed</h2>

      <div className={styles.achievementsCard}>
        <div className={styles.achievementsContent}>
          <p className={styles.achievementsText}>
            You have earned and uploaded <strong>{badgeCount} badges</strong>
          </p>
          <p className={styles.achievementsSubtext}>
            Currently, there are no badges uploaded to your profile. Begin your journey towards your
            certification goals impress your peers with your accomplishments. Start preparing for
            your next certificate today!
          </p>
        </div>
      </div>
    </section>
  );
}
