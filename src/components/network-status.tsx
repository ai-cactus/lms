"use client";

import { useNetwork } from '@/contexts/network-context';
import { WifiSlash, ArrowClockwise } from '@phosphor-icons/react';

export function NetworkStatus() {
    const { isOnline, isRetrying, retryCount } = useNetwork();

    // Don't show anything if everything is fine
    if (isOnline && !isRetrying) {
        return null;
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-50 animate-in slide-in-from-top duration-300">
            <div className={`py-2 px-4 text-center text-sm font-medium ${isOnline ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                }`}>
                <div className="flex items-center justify-center gap-2">
                    {!isOnline ? (
                        <>
                            <WifiSlash size={16} weight="fill" />
                            <span>You are offline. Please check your connection.</span>
                        </>
                    ) : (
                        <>
                            <ArrowClockwise
                                size={16}
                                weight="bold"
                                className="animate-spin"
                            />
                            <span>
                                Connection issues detected. Retrying...
                                {retryCount > 0 && ` (Attempt ${retryCount})`}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
