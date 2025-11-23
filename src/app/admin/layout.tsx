import { Sidebar } from "@/components/admin/Sidebar";
import { Header } from "@/components/admin/Header";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-slate-50">
            <Sidebar />
            <div className="pl-64 flex flex-col min-h-screen">
                <Header />
                <main className="flex-1 p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
