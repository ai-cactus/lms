"use client";
import { SessionProvider } from "next-auth/react";

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider basePath="/api/auth">
            {children}
        </SessionProvider>
    );
}
