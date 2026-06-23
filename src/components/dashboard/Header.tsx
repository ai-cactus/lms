'use client';

import React, { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { getNotifications, markAsRead, markAllAsRead } from '@/app/actions/notifications';
import NotificationPanel from '@/components/notifications/NotificationPanel';
import { Bell, ChevronDown, Smile, LogOut, Menu } from 'lucide-react';

interface Notification {
  id: string;
  title: string;
  message: string;
  linkUrl?: string | null;
  isRead: boolean;
  type?: string;
  resolvedAt?: Date | null;
  createdAt: Date;
}

interface HeaderProps {
  fullName: string;
  onMenuClick?: () => void;
}

export default function Header({ fullName, onMenuClick }: HeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Notification state
  const [notifications, setNotifications] = useState<Notification[]>([]);
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
      setNotifications(res.notifications as Notification[]);
      setUnreadCount(res.unreadCount || 0);
    }
    setIsLoadingNotifs(false);
  };

  const handleMarkAsRead = async (id: string, linkUrl?: string | null) => {
    await markAsRead(id);
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

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleLogout = () => {
    setIsLogoutModalOpen(true);
  };

  const handleConfirmLogout = async () => {
    await signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` });
  };

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
    <>
      <header className="flex h-16 items-center justify-between border-b border-[#e2e8f0] bg-white px-4 lg:h-20 lg:justify-end lg:px-10">
        {/* Hamburger — visible only on <lg */}
        <button
          className="flex size-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-[#f7fafc] text-[#4a5568] transition-colors hover:bg-[#edf2f7] lg:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="size-[22px]" />
        </button>

        <div className="flex items-center gap-6 lg:gap-6">
          {/* Notifications */}
          <div className="relative inline-flex" ref={notifRef}>
            <button
              className="relative rounded-full bg-[#f7fafc] p-2 text-[#718096] transition-colors hover:bg-[#edf2f7]"
              onClick={toggleNotif}
              aria-label="Toggle notifications"
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-[#e53e3e] px-1 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <NotificationPanel
                notifications={notifications}
                unreadCount={unreadCount}
                isLoading={isLoadingNotifs}
                onMarkAllAsRead={handleMarkAllAsRead}
                onItemClick={handleMarkAsRead}
                viewAllHref="/dashboard/notifications"
                onViewAll={() => setIsNotifOpen(false)}
              />
            )}
          </div>

          {/* Profile Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <div
              className="flex cursor-pointer select-none items-center gap-3 rounded-full bg-[#f7fafc] py-1.5 pl-1.5 pr-3 transition-colors hover:bg-[#edf2f7]"
              onClick={toggleDropdown}
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-[#bfccfa] text-xs font-semibold text-[#2d4ddd]">
                <span className="text-xs font-semibold">
                  {fullName
                    ? fullName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .substring(0, 2)
                        .toUpperCase()
                    : 'U'}
                </span>
              </div>
              <span className="hidden text-sm font-semibold text-[#2d3748] lg:block">
                {fullName}
              </span>
              <ChevronDown
                className={[
                  'hidden size-4 text-[#cbd5e0] transition-transform duration-200 lg:inline',
                  isOpen ? 'rotate-180' : 'rotate-0',
                ].join(' ')}
              />
            </div>

            {isOpen && (
              <div className="absolute right-0 top-[calc(100%+12px)] z-50 flex w-[220px] flex-col gap-1 rounded-2xl border border-[#f1f4f9] bg-white p-2 shadow-lg">
                <Link
                  href="/profile"
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-none bg-none px-4 py-3 text-left text-sm font-medium text-[#718096] transition-all hover:bg-[#f7fafc] hover:text-[#2d3748] [&_svg]:text-[#a0aec0] hover:[&_svg]:text-[#4a5568]"
                  onClick={() => setIsOpen(false)}
                >
                  <Smile className="size-[18px]" />
                  Profile
                </Link>
                <button
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-none bg-none px-4 py-3 text-left text-sm font-medium text-[#e53e3e] transition-all hover:bg-[#fff5f5] hover:text-[#c53030] [&_svg]:text-[#e53e3e] hover:[&_svg]:text-[#c53030]"
                  onClick={handleLogout}
                >
                  <LogOut className="size-[18px]" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Logout Confirmation Dialog */}
      <Dialog open={isLogoutModalOpen} onOpenChange={setIsLogoutModalOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader className="items-center text-center">
            <div className="mb-4">
              <LogOut className="mx-auto size-12 text-[#e53e3e]" />
            </div>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to log out? You will need to sign in again to access your
              account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center sm:justify-center">
            <Button variant="outline" onClick={() => setIsLogoutModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleConfirmLogout}>
              Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
