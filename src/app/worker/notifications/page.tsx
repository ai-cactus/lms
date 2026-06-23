import React from 'react';
import NotificationsView from '@/components/notifications/NotificationsView';

export const dynamic = 'force-dynamic';

export default function WorkerNotificationsPage() {
  return <NotificationsView backHref="/worker" audience="worker" />;
}
