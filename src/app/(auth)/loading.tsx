import { Loader2 } from 'lucide-react';
import { Logo } from '@/components/ui';

export default function Loading() {
  return (
    <div className="flex flex-col w-full h-full justify-center items-center 2xl:w-max 2xl:items-end py-10 md:px-15 px-5">
      <div className="flex flex-col w-full gap-10">
        <div className="flex flex-col gap-5">
          <Logo size="md" causeRedirect />
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    </div>
  );
}
