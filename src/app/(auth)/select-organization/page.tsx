import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listActiveMemberships } from '@/lib/auth/membership';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import { Logo } from '@/components/ui';
import OrganizationPickerList from './OrganizationPickerList';

export const metadata = {
  title: 'Choose an organization',
};

export default async function SelectOrganizationPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const memberships = await listActiveMemberships(userId);

  // Nothing to choose between — never strand the user on a one-option picker.
  if (memberships.length === 0) redirect('/onboarding');
  if (memberships.length === 1) redirect('/dashboard');

  const activeOrganizationId = session?.user?.organizationId ?? null;

  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
          <div className="w-full text-left flex flex-col gap-1">
            <h1 className="text-headline-3 font-semibold font-headline leading-8 text-text-bold">
              Choose an organization
            </h1>
            <p className="text-base leading-6 font-text text-text-neutral">
              You belong to more than one organization. Pick the one you want to work in — you can
              switch at any time.
            </p>
          </div>
        </div>

        <OrganizationPickerList
          organizations={memberships.map((membership) => ({
            organizationId: membership.organizationId,
            organizationName: membership.organizationName,
            roleLabel: getRoleDisplayName(membership.role),
          }))}
          activeOrganizationId={activeOrganizationId}
        />
      </div>
    </div>
  );
}
