import { FC } from 'react';
import { AdminSessionProvider } from '@/components/providers/AdminSessionProvider';
import { WithChildren } from '@/types/react';
import AuthHeroSlider from './components/AuthHeroSlider';

const AuthLayout: FC<WithChildren> = ({ children }) => {
  return (
    <AdminSessionProvider>
      <div className="flex h-screen w-screen lg:p-4 gap-4">
        <div className="flex h-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide 2xl:justify-end">
          {children}
        </div>
        <AuthHeroSlider />
      </div>
    </AdminSessionProvider>
  );
};

export default AuthLayout;
