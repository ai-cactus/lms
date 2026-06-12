/**
 * Returns the human-readable label and shadcn Badge variant for a course type.
 * 'video' → System Training (global, admin-published)
 * 'text'  → Custom Training (AI-generated, org-specific)
 */
export function courseTypeLabel(type: string | null | undefined): string {
  return type === 'video' ? 'System Training' : 'Custom Training';
}

export function courseTypeBadgeVariant(type: string | null | undefined): 'secondary' | 'outline' {
  return type === 'video' ? 'secondary' : 'outline';
}
