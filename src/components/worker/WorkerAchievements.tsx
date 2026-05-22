'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';

interface WorkerAchievementsProps {
  badgeCount: number;
  completedCourses?: { id: string; title: string }[];
}

export default function WorkerAchievements({
  badgeCount,
  completedCourses = [],
}: WorkerAchievementsProps) {
  return (
    <section className={styles.achievementsSection}>
      <h2 className={styles.sectionTitle}>Courses Completed</h2>

      <div className={styles.achievementsCard}>
        <div className={styles.achievementsContent}>
          <p className={styles.achievementsText}>
            You have earned and uploaded <strong>{badgeCount} certificates</strong>
          </p>
          {completedCourses.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {completedCourses.map((course) => (
                <p key={course.id} className={styles.achievementsSubtext}>
                  You have earned a certificate for the completion of{' '}
                  <strong>{course.title}</strong>
                </p>
              ))}
            </div>
          ) : (
            <p className={styles.achievementsSubtext}>
              Currently, there are no certificates uploaded to your profile. Begin your journey
              towards your certification goals impress your peers with your accomplishments. Start
              preparing for your next certificate today!
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
