import { WorkerLayout } from "@/components/worker/worker-layout";

import { ForcePasswordChangeModal } from "@/components/auth/ForcePasswordChangeModal";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <ForcePasswordChangeModal />
            <WorkerLayout>{children}</WorkerLayout>
        </>
    );
}
