'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from '@/components/dashboard/Header.module.css';
import layoutStyles from '@/app/dashboard/(main)/layout.module.css';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { getNotifications, markAsRead, markAllAsRead } from '@/app/actions/notifications';

interface HeaderProps {
  userEmail: string;
  fullName: string;
  onMenuClick?: () => void;
}

export default function WorkerHeader({ userEmail, fullName, onMenuClick }: HeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // Notification state
  const [notifications, setNotifications] = useState<
    {
      id: string;
      title: string;
      message: string;
      isRead: boolean;
      linkUrl?: string | null;
      createdAt: string | Date;
    }[]
  >([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingNotifs, setIsLoadingNotifs] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    setIsNotifOpen(false);
  };

  const toggleNotif = async () => {
    setIsNotifOpen(!isNotifOpen);
    setIsOpen(false);
    if (!isNotifOpen) {
      fetchNotifications();
    }
  };

  const fetchNotifications = async () => {
    setIsLoadingNotifs(true);
    const res = await getNotifications();
    if (res.success && res.notifications !== undefined) {
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount || 0);
    }
    setIsLoadingNotifs(false);
  };

  const handleMarkAsRead = async (id: string, linkUrl?: string | null) => {
    await markAsRead(id);
    // Optimistically update
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));

    if (linkUrl) {
      router.push(linkUrl);
      setIsNotifOpen(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleLogout = async () => {
    await signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className={styles.header}>
      {/* Hamburger — visible on mobile only */}
      <button className={layoutStyles.hamburger} onClick={onMenuClick} aria-label="Open menu">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className={styles.headerEnd}>
        <div className={styles.notificationWrapper} ref={notifRef}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={styles.iconButton}
            onClick={toggleNotif}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
          </Button>

          {isNotifOpen && (
            <div className={styles.notificationsDropdown}>
              <div className={styles.notificationsHeader}>
                <h3>Notifications</h3>
                {unreadCount > 0 && (
                  <button className={styles.markAllReadBtn} onClick={handleMarkAllAsRead}>
                    Mark all as read
                  </button>
                )}
              </div>
              <div className={styles.notificationsBody}>
                {isLoadingNotifs ? (
                  <div className={styles.emptyState}>
                    <p className={styles.emptyStateSubtext}>Loading...</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyStateIcon}>
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                      </svg>
                    </div>
                    <h4 className={styles.emptyStateText}>No new notifications</h4>
                    <p className={styles.emptyStateSubtext}>
                      When courses are assigned or new events happen, they will appear here.
                    </p>
                  </div>
                ) : (
                  <div className={styles.notificationList}>
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`${styles.notificationItem} ${!notif.isRead ? styles.unread : ''}`}
                        onClick={() => handleMarkAsRead(notif.id, notif.linkUrl)}
                      >
                        <div className={styles.notifContent}>
                          <h4 className={styles.notifTitle}>{notif.title}</h4>
                          <p className={styles.notifMessage}>{notif.message}</p>
                          <span className={styles.notifTime}>
                            {new Date(notif.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {!notif.isRead && <div className={styles.unreadDot} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.profileWrapper} ref={dropdownRef}>
          <div className={styles.profile} onClick={toggleDropdown}>
            <div className={styles.avatar}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <span className={styles.profileName}>{fullName}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>

          {isOpen && (
            <div className={styles.dropdown}>
              <Link
                href="/worker/profile"
                className={styles.dropdownItem}
                onClick={() => setIsOpen(false)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                  <line x1="9" y1="9" x2="9.01" y2="9"></line>
                  <line x1="15" y1="9" x2="15.01" y2="9"></line>
                </svg>
                Edit Profile
              </Link>
              <Button
                variant="ghost"
                className={`${styles.dropdownItem} ${styles.logout}`}
                onClick={handleLogout}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Logout
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
