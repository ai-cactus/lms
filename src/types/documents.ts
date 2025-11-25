// Document Management Type Definitions

export interface DocumentType {
    id: string;
    name: string;
    description: string;
    icon: string;
    slug: string;
    organization_id?: string;
    display_order: number;
    created_at: string;
    updated_at: string;

    // Computed fields (from joins)
    total_categories?: number;
    completed_categories?: number;
    recent_uploaders?: string[];
}

export interface DocumentCategory {
    id: string;
    document_type_id: string;
    name: string;
    description: string;
    slug: string;
    is_required: boolean;
    min_documents: number;
    display_order: number;
    created_at: string;
    updated_at: string;

    // Computed fields (from joins)
    documents_count?: number;
    status?: 'pending' | 'in_progress' | 'completed';
    last_uploaded_at?: string;
}

export interface PolicyDocument {
    id: string;
    organization_id: string;
    document_category_id?: string;
    title: string;
    file_name: string;
    file_url: string;
    file_size?: number;
    mime_type?: string;
    version: number;
    status: 'draft' | 'published' | 'archived';
    uploaded_by?: string;
    created_at: string;
    updated_at: string;

    // Computed fields
    uploader?: {
        id: string;
        full_name: string;
        avatar_url?: string;
    };
}

export interface CategoryUploadStatus {
    id: string;
    category_id: string;
    organization_id: string;
    documents_count: number;
    status: 'pending' | 'in_progress' | 'completed';
    last_uploaded_at?: string;
    created_at: string;
    updated_at: string;
}

// Helper type for category status display
export interface CategoryStatusBadge {
    text: string;
    color: 'yellow' | 'blue' | 'green';
    variant: 'pending' | 'progress' | 'completed';
}
