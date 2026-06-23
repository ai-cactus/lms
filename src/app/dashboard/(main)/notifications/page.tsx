import React from 'react';
import NotificationsView from '@/components/notifications/NotificationsView';

export const dynamic = 'force-dynamic';

export default function NotificationsPage() {
  return <NotificationsView backHref="/dashboard" audience="admin" />;
}
