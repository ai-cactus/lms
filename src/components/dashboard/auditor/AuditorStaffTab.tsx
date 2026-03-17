'use client';

import { useState, useEffect, useTransition } from 'react';
import styles from './auditor-pack.module.css';
import { getAuditorStaff } from '@/app/actions/auditor';
import type { AuditorStaffRow } from '@/app/actions/auditor';

export default function AuditorStaffTab() {
  const [staff, setStaff] = useState<AuditorStaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorStaff(search || undefined);
        setStaff(data);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Staff Progress</h2>
        <div className={styles.sectionControls}>
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search staff..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search staff members"
            />
          </div>
        </div>
      </div>

      {isPending && staff.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyDesc}>Loading staff&hellip;</p>
        </div>
      ) : staff.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration}>
            <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
              <circle cx="20" cy="16" r="8" stroke="#C7D2FE" strokeWidth="3" fill="none" />
              <path
                d="M4 40c0-8.837 7.163-16 16-16"
                stroke="#C7D2FE"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="38"
                y1="32"
                x2="38"
                y2="42"
                stroke="#4731F7"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <line
                x1="33"
                y1="37"
                x2="43"
                y2="37"
                stroke="#4731F7"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className={styles.emptyTitle}>No staff found.</p>
          <p className={styles.emptyDesc}>
            {search ? 'No staff match your search.' : 'No staff members in your organization yet.'}
          </p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Courses Assigned</th>
                <th>Completed</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className={styles.staffCell}>
                      <div className={styles.staffAvatar} aria-hidden>
                        {member.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={styles.staffName}>{member.name}</div>
                        <div className={styles.staffEmail}>{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{member.coursesAssigned}</td>
                  <td className={styles.completionRate}>{member.coursesCompleted}</td>
                  <td className={styles.dateText}>
                    {member.lastActivity
                      ? member.lastActivity.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
