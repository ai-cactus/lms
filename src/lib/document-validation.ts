export interface DocumentLimits {
    maxSizeBytes: number;
    estimatedMaxChars: number;
    description: string;
}

export const DOCUMENT_LIMITS: Record<string, DocumentLimits> = {
    'application/pdf': {
        maxSizeBytes: 25 * 1024 * 1024, // 25MB
        estimatedMaxChars: 500000, // ~500k characters estimated
        description: 'PDF files (max 25MB)'
    },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        maxSizeBytes: 50 * 1024 * 1024, // 50MB
        estimatedMaxChars: 750000, // ~750k characters estimated
        description: 'DOCX files (max 50MB)'
    },
    'application/msword': {
        maxSizeBytes: 50 * 1024 * 1024, // 50MB
        estimatedMaxChars: 750000,
        description: 'DOC files (max 50MB)'
    },
    'text/plain': {
        maxSizeBytes: 10 * 1024 * 1024, // 10MB
        estimatedMaxChars: 10 * 1024 * 1024, // 1 byte ≈ 1 char for text
        description: 'Text files (max 10MB)'
    },
    'text/markdown': {
        maxSizeBytes: 10 * 1024 * 1024, // 10MB
        estimatedMaxChars: 10 * 1024 * 1024,
        description: 'Markdown files (max 10MB)'
    }
};

export interface ValidationResult {
    isValid: boolean;
    error?: string;
    warning?: string;
    limits?: DocumentLimits;
}

export function validateDocumentForProcessing(file: File): ValidationResult {
    const limits = DOCUMENT_LIMITS[file.type];
    
    if (!limits) {
        return {
            isValid: false,
            error: `Unsupported file type: ${file.type}. Supported types: PDF, DOCX, DOC, TXT, MD`
        };
    }

    // Check file size
    if (file.size > limits.maxSizeBytes) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const limitMB = (limits.maxSizeBytes / (1024 * 1024)).toFixed(0);
        return {
            isValid: false,
            error: `File size (${sizeMB}MB) exceeds limit for ${limits.description}. Maximum allowed: ${limitMB}MB`,
            limits
        };
    }

    // Estimate content size and warn if it might be too large for AI processing
    const estimatedChars = estimateTextContent(file);
    if (estimatedChars > limits.estimatedMaxChars) {
        return {
            isValid: true,
            warning: `This document may be too large for optimal AI processing. Consider splitting it into smaller sections.`,
            limits
        };
    }

    // Check if file is very small (might be empty or corrupted)
    if (file.size < 100) {
        return {
            isValid: false,
            error: `File appears to be empty or corrupted (${file.size} bytes)`
        };
    }

    return {
        isValid: true,
        limits
    };
}

function estimateTextContent(file: File): number {
    // Rough estimation based on file type and size
    switch (file.type) {
        case 'application/pdf':
            // PDFs are typically 10-20% text content by size
            return Math.floor(file.size * 0.15);
        
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
            // DOCX files are typically 5-15% text content by size (due to XML overhead)
            return Math.floor(file.size * 0.10);
        
        case 'text/plain':
        case 'text/markdown':
            // Text files are nearly 100% text content
            return file.size;
        
        default:
            // Conservative estimate
            return Math.floor(file.size * 0.10);
    }
}

export function getValidFileTypes(): string[] {
    return Object.keys(DOCUMENT_LIMITS);
}

export function getFileTypeDescription(mimeType: string): string {
    return DOCUMENT_LIMITS[mimeType]?.description || 'Unknown file type';
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
