"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface NetworkContextType {
    isOnline: boolean;
    isRetrying: boolean;
    retryCount: number;
    startRetry: () => void;
    endRetry: () => void;
    incrementRetry: () => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
    const [isOnline, setIsOnline] = useState(true); // Default to online for SSR compatibility
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        // Set initial online status on client side
        setIsOnline(navigator.onLine);

        // Monitor browser online/offline status
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const startRetry = () => {
        setIsRetrying(true);
        setRetryCount(0);
    };

    const endRetry = () => {
        setIsRetrying(false);
        setRetryCount(0);
    };

    const incrementRetry = () => {
        setRetryCount(prev => prev + 1);
    };

    return (
        <NetworkContext.Provider
            value={{
                isOnline,
                isRetrying,
                retryCount,
                startRetry,
                endRetry,
                incrementRetry,
            }}
        >
            {children}
        </NetworkContext.Provider>
    );
}

export function useNetwork() {
    const context = useContext(NetworkContext);
    if (!context) {
        throw new Error('useNetwork must be used within NetworkProvider');
    }
    return context;
}
