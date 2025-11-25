"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

type NotificationType = "success" | "error" | "info" | "warning";

interface Notification {
    id: string;
    type: NotificationType;
    message: string;
}

interface NotificationContextType {
    showNotification: (type: NotificationType, message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function useNotification() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error("useNotification must be used within NotificationProvider");
    }
    return context;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const showNotification = useCallback((type: NotificationType, message: string) => {
        const id = Math.random().toString(36).substring(7);
        setNotifications(prev => [...prev, { id, type, message }]);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000);
    }, []);

    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const getIcon = (type: NotificationType) => {
        switch (type) {
            case "success":
                return <CheckCircle className="w-5 h-5" />;
            case "error":
                return <AlertCircle className="w-5 h-5" />;
            case "warning":
                return <AlertTriangle className="w-5 h-5" />;
            case "info":
                return <Info className="w-5 h-5" />;
        }
    };

    const getStyles = (type: NotificationType) => {
        switch (type) {
            case "success":
                return "bg-green-50 border-green-200 text-green-800";
            case "error":
                return "bg-red-50 border-red-200 text-red-800";
            case "warning":
                return "bg-yellow-50 border-yellow-200 text-yellow-800";
            case "info":
                return "bg-blue-50 border-blue-200 text-blue-800";
        }
    };

    return (
        <NotificationContext.Provider value={{ showNotification }}>
            {children}

            {/* Notification Container */}
            <div className="fixed top-4 right-4 z-[9999] space-y-3">
                {notifications.map((notification) => (
                    <div
                        key={notification.id}
                        className={`
                            min-w-[320px] max-w-md
                            border rounded-xl shadow-lg
                            p-4 pr-12
                            flex items-start gap-3
                            animate-in slide-in-from-right duration-300
                            ${getStyles(notification.type)}
                        `}
                    >
                        <div className="flex-shrink-0 mt-0.5">
                            {getIcon(notification.type)}
                        </div>
                        <div className="flex-1 text-sm font-medium leading-relaxed">
                            {notification.message}
                        </div>
                        <button
                            onClick={() => dismissNotification(notification.id)}
                            className="absolute top-3 right-3 text-current opacity-60 hover:opacity-100 transition-opacity"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
        </NotificationContext.Provider>
    );
}
