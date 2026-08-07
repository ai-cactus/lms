import { FC, useState, useRef, useEffect, Ref } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import NotificationPanel from '@/components/notifications/NotificationPanel';
import { useNotifications } from '@/components/notifications/useNotifications';
import { clearSiblingSessionCookie } from '@/app/actions/session-bridge';
import { Bell, ChevronDown, Smile, LogOut, Menu } from 'lucide-react';

interface DefaultDashboardNavBarProps {
  fullName: string;
  forProfile: boolean;
  onMenuClick?: () => void;
}

interface ProfileDashboardNavBarProps {
  fullName: string;
}

interface UserProfileProps {
  isOpen: boolean;
  fullName: string;
  ref: Ref<HTMLDivElement> | null;
  onProfileClick: () => void;
  onLogout: () => void;
  onDropDown: () => void;
}

const handleConfirmLogout = async () => {
  try {
    await clearSiblingSessionCookie('admin');
  } catch {}
  await signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/login` });
};

const UserProfile: FC<UserProfileProps> = ({
  fullName,
  isOpen,
  ref,
  onProfileClick,
  onLogout,
  onDropDown,
}) => {
  return (
    <div className="relative" ref={ref}>
      <div
        className="flex h-[44px] cursor-pointer select-none items-center gap-2 rounded-full bg-[#f7f7f7] px-[7px] transition-colors hover:bg-[#edf2f7] lg:h-[56px] lg:px-[10px]"
        onClick={onDropDown}
      >
        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#bfccfa] text-sm font-semibold text-[#2d4ddd] lg:size-[38px]">
          <span>
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
        <span className="hidden text-sm font-semibold text-[#292d32] lg:block">{fullName}</span>
        <ChevronDown
          className={[
            'hidden size-6 text-[#cbd5e0] transition-transform duration-200 lg:inline',
            isOpen ? 'rotate-180' : 'rotate-0',
          ].join(' ')}
        />
      </div>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+12px)] z-50 flex w-[220px] flex-col gap-1 rounded-2xl border border-[#f1f4f9] bg-white p-2 shadow-lg">
          <Link
            href="/profile"
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-none bg-none px-4 py-3 text-left text-sm font-medium text-[#718096] transition-all hover:bg-[#f7fafc] hover:text-[#2d3748] [&_svg]:text-[#a0aec0] hover:[&_svg]:text-[#4a5568]"
            onClick={onProfileClick}
          >
            <Smile className="size-[18px]" />
            Profile
          </Link>
          <button
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-none bg-none px-4 py-3 text-left text-sm font-medium text-[#e53e3e] transition-all hover:bg-[#fff5f5] hover:text-[#c53030] [&_svg]:text-[#e53e3e] hover:[&_svg]:text-[#c53030]"
            onClick={onLogout}
          >
            <LogOut className="size-[18px]" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

export const DefaultDashboardNavBar: FC<DefaultDashboardNavBarProps> = ({
  fullName,
  onMenuClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const {
    notifications,
    unreadCount,
    isLoading: isLoadingNotifs,
    refresh,
    markRead,
    markAll,
  } = useNotifications({ pollMs: 60_000 });

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    setIsNotifOpen(false);
  };

  const toggleNotif = () => {
    setIsNotifOpen(!isNotifOpen);
    setIsOpen(false);
    if (!isNotifOpen) {
      refresh();
    }
  };

  const handleItemClick = (id: string, linkUrl?: string | null) => {
    markRead(id);
    if (linkUrl) {
      router.push(linkUrl);
      setIsNotifOpen(false);
    }
  };

  const handleLogout = () => setIsLogoutModalOpen(true);

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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <header className="relative z-20 flex h-[60px] shrink-0 items-center justify-between border-b border-black/10 bg-white pl-6 pr-6 lg:h-20 lg:justify-end lg:pl-0 lg:pr-[46px]">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            className="flex size-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-[#f9fafb] text-[#0c111d] transition-colors hover:bg-[#edf2f7]"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="size-[22px]" />
          </button>
          <Logo size="sm" variant="brand" />
        </div>
        <div className="flex items-center gap-4">
          <div className="relative inline-flex" ref={notifRef}>
            <button
              className="relative flex size-10 cursor-pointer items-center justify-center rounded-[12px] bg-[#f9fafb] text-[#0c111d] transition-colors hover:bg-[#edf2f7] lg:size-14"
              onClick={toggleNotif}
              aria-label="Toggle notifications"
            >
              <Bell className="size-5 lg:size-[26px]" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex size-[17px] items-center justify-center rounded-full bg-[#ac0000] text-[11px] font-medium leading-none text-white lg:right-[9px] lg:top-[9px]">
                  {unreadCount}
                </span>
              )}
            </button>
            {isNotifOpen && (
              <NotificationPanel
                notifications={notifications}
                unreadCount={unreadCount}
                isLoading={isLoadingNotifs}
                onMarkAllAsRead={markAll}
                onItemClick={handleItemClick}
                viewAllHref="/dashboard/notifications"
                onViewAll={() => setIsNotifOpen(false)}
              />
            )}
          </div>
          <UserProfile
            isOpen={isOpen}
            fullName={fullName}
            ref={dropdownRef}
            onLogout={handleLogout}
            onDropDown={toggleDropdown}
            onProfileClick={() => setIsOpen(false)}
          />
        </div>
      </header>
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
};

export const ProfileDashboardNavBar: FC<ProfileDashboardNavBarProps> = ({ fullName }) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const toggleDropdown = () => setIsOpen(!isOpen);
  const handleLogout = () => setIsLogoutModalOpen(true);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <header className="relative z-20 flex h-[64px] shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-white px-6 lg:h-[106px] lg:pl-[112px] lg:pr-[110px]">
        <div className="flex items-center">
          <Logo size="md" variant="blue" />
        </div>
        <UserProfile
          isOpen={isOpen}
          fullName={fullName}
          ref={dropdownRef}
          onLogout={handleLogout}
          onDropDown={toggleDropdown}
          onProfileClick={() => setIsOpen(false)}
        />
      </header>
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
};
