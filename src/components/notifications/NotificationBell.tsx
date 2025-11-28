"use client";

import { useEffect, useState } from "react";
import { Bell, X, CheckCircle, XCircle, Clock, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
    getUnreadNotifications,
    getAllNotifications,
    markNotificationAsRead,
    markAllAsRead,
} from "@/app/actions/notifications";

interface Notification {
    id: string;
    type: string;
    title: string;
    message: string;
    data: any;
    read: boolean;
    created_at: string;
}

export default function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadNotifications();
        setupRealtimeSubscription();
    }, []);

    const loadNotifications = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const allNotifs = await getAllNotifications(user.id, 20);
            const unread = allNotifs.filter((n: Notification) => !n.read);

            setNotifications(allNotifs as Notification[]);
            setUnreadCount(unread.length);
        } catch (error) {
            console.error("Error loading notifications:", error);
        }
    };

    const setupRealtimeSubscription = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Subscribe to realtime changes for this user's notifications
        const channel = supabase
            .channel('notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    const newNotif = payload.new as Notification;
                    setNotifications((prev) => [newNotif, ...prev]);
                    setUnreadCount((prev) => prev + 1);

                    // Optional: Show browser notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification(newNotif.title, {
                            body: newNotif.message,
                            icon: '/logo.png',
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    };

    const handleMarkAsRead = async (notificationId: string) => {
        try {
            await markNotificationAsRead(notificationId);
            setNotifications((prev) =>
                prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (error) {
            console.error("Error marking as read:", error);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            await markAllAsRead(user.id);
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error("Error marking all as read:", error);
        }
    };

    const handleNotificationClick = (notification: Notification) => {
        handleMarkAsRead(notification.id);

        // Navigate based on notification type
        if (notification.data?.workerId) {
            router.push(`/admin/staff/${notification.data.workerId}`);
        } else if (notification.data?.courseId) {
            router.push(`/admin/courses/${notification.data.courseId}`);
        }

        setShowDropdown(false);
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'course_started':
                return <Clock className="w-5 h-5 text-blue-600" />;
            case 'course_passed':
                return <CheckCircle className="w-5 h-5 text-green-600" />;
            case 'course_failed':
                return <XCircle className="w-5 h-5 text-red-600" />;
            case 'course_completed':
                return <BookOpen className="w-5 h-5 text-indigo-600" />;
            default:
                return <Bell className="w-5 h-5 text-slate-600" />;
        }
    };

    const displayedNotifications = showAll ? notifications : notifications.slice(0, 5);

    return (
        <div className="relative">
            {/* Bell Icon Button */}
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
                <Bell className="w-5 h-5 text-slate-600" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {showDropdown && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowDropdown(false)}
                    ></div>
                    <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-20 max-h-[600px] overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900">Notifications</h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    Mark all as read
                                </button>
                            )}
                        </div>

                        {/* Notifications List */}
                        <div className="overflow-y-auto flex-1">
                            {notifications.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">
                                    <Bell className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                                    <p>No notifications yet</p>
                                </div>
                            ) : (
                                displayedNotifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification)}
                                        className={`p-4 border-b border-gray-100 cursor-pointer transition-colors hover:bg-slate-50 ${!notification.read ? 'bg-blue-50' : ''
                                            }`}
                                    >
                                        <div className="flex gap-3">
                                            <div className="flex-shrink-0 mt-1">
                                                {getNotificationIcon(notification.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="font-semibold text-slate-900 text-sm">
                                                        {notification.title}
                                                    </p>
                                                    {!notification.read && (
                                                        <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-1"></div>
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-600 mt-1">
                                                    {notification.message}
                                                </p>
                                                <p className="text-xs text-slate-400 mt-2">
                                                    {new Date(notification.created_at).toLocaleString()}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        {notifications.length > 5 && (
                            <div className="p-3 border-t border-gray-200">
                                <button
                                    onClick={() => setShowAll(!showAll)}
                                    className="w-full text-center text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    {showAll ? 'Show less' : `View all ${notifications.length} notifications`}
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
