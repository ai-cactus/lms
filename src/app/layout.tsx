import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";
import { NetworkProvider } from "@/contexts/network-context";
import { NotificationProvider } from "@/contexts/notification-context";
import { NetworkStatus } from "@/components/network-status";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Theraptly - Training Platform",
  description: "AI-powered Learning Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-slate-50 text-slate-900`}>
        <NetworkProvider>
          <NotificationProvider>
            <NetworkStatus />
            {children}
            <SpeedInsights />
            <Analytics />
          </NotificationProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
