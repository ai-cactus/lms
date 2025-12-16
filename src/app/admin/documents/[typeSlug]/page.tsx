"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DocumentType, DocumentCategory } from "@/types/documents";
import { ArrowLeft, Folder, CheckCircle, Clock, Plus } from "lucide-react";
import Link from "next/link";

interface CategoryWithStatus extends Omit<DocumentCategory, 'status'> {
    uploadedCount: number;
    status: 'pending' | 'uploaded';
}

export default function DocumentTypePage() {
    const [documentType, setDocumentType] = useState<DocumentType | null>(null);
    const [categories, setCategories] = useState<CategoryWithStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const typeSlug = params.typeSlug as string;

    useEffect(() => {
        if (typeSlug) {
            loadData();
        }
    }, [typeSlug]);

    const loadData = async () => {
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
            const orgId = userData.organization_id;

            // 1. Fetch Document Type
            const { data: typeData, error: typeError } = await supabase
                .from("document_types")
                .select("*")
                .eq("slug", typeSlug)
                .single();

            if (typeError || !typeData) {
                console.error("Error loading document type:", typeError);
                router.push("/admin/documents");
                return;
            }

            setDocumentType(typeData);

            // 2. Fetch Categories for this Type
            const { data: categoriesData, error: catError } = await supabase
                .from("document_categories")
                .select("*")
                .eq("document_type_id", typeData.id)
                .order("display_order", { ascending: true });

            if (catError) throw catError;

            // 3. Fetch Upload Counts for each Category
            // We need to check the 'policies' table for documents in this org and category
            const categoriesWithStatus = await Promise.all(
                (categoriesData || []).map(async (cat) => {
                    const { count } = await supabase
                        .from("policies")
                        .select("*", { count: "exact", head: true })
                        .eq("organization_id", orgId)
                        .eq("document_category_id", cat.id);

                    return {
                        ...cat,
                        uploadedCount: count || 0,
                        status: (count && count > 0) ? 'uploaded' : 'pending'
                    } as CategoryWithStatus;
                })
            );

            setCategories(categoriesWithStatus);
            setLoading(false);
        } catch (error) {
            console.error("Error loading data:", error);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-slate-600">Loading...</div>
            </div>
        );
    }

    if (!documentType) return null;

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center hover:text-slate-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Go Back
                    </button>
                    <span>/</span>
                    <span>CARF Plan</span>
                    <span>/</span>
                    <span className="text-blue-600 font-medium">{documentType.name}</span>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">{documentType.name}</h1>
                        <p className="text-slate-500">
                            Documents and attachments that have been uploaded are displayed here
                        </p>
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                        <Plus className="w-4 h-4" />
                        Add New
                    </button>
                </div>
            </div>

            {/* Categories List */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                    <h2 className="font-semibold text-slate-900">Required Document Categories</h2>
                </div>

                <div className="divide-y divide-slate-100">
                    {categories.map((category) => (
                        <Link
                            key={category.id}
                            href={`/admin/documents/${typeSlug}/${category.slug}`}
                            className="flex items-center justify-between p-6 hover:bg-white transition-colors group"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors">
                                    <Folder className="w-5 h-5" />
                                </div>
                                <span className="font-medium text-slate-900">{category.name}</span>
                            </div>

                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${category.status === 'uploaded'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                                }`}>
                                {category.status === 'uploaded' ? (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        {category.uploadedCount} documents uploaded
                                    </>
                                ) : (
                                    <>
                                        <Clock className="w-4 h-4" />
                                        Pending Upload
                                    </>
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
