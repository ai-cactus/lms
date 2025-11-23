import { WorkerLayout } from "@/components/worker/worker-layout";

export default function Layout({ children }: { children: React.ReactNode }) {
    return <WorkerLayout>{children}</WorkerLayout>;
}
