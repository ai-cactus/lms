import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { checkSystemAuth, getUserDetail } from '@/app/actions/system-admin';
import UserDetailClient from '@/components/system/UserDetailClient';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const authenticated = await checkSystemAuth();
  if (!authenticated) {
    redirect('/system');
  }

  const { id } = await params;
  const user = await getUserDetail(id);

  if (!user) {
    notFound();
  }

  return <UserDetailClient user={user} />;
}
