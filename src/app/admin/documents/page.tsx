"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DocumentType } from "@/types/documents";
import DocumentTypeCard from "@/components/documents/DocumentTypeCard";

export default function DocumentsPage() {
    const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadDocumentTypes();
    }, []);

    const loadDocumentTypes = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get user's organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData) return;

            // Fetch global document types (no organization_id)
            const { data: types, error } = await supabase
                .from("document_types")
                .select("*")
                .is("organization_id", null)
                .order("display_order", { ascending: true });

            if (error) throw error;

            setDocumentTypes(types || []);
            setLoading(false);
        } catch (error) {
            console.error("Error loading document types:", error);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-slate-600">Loading documents...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-slate-900">Documents</h1>
                <p className="text-slate-500 mt-2">
                    Documents and attachments that have been uploaded are displayed here
                </p>
            </div>

            {/* Document Type Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                {documentTypes.map((type) => (
                    <DocumentTypeCard
                        key={type.id}
                        documentType={type}
                        onClick={() => router.push(`/admin/documents/${type.slug}`)}
                    />
                ))}
            </div>
        </div>
    );
}
