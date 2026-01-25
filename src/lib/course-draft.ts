import { createClient } from "@/lib/supabase/client";
import { CourseData } from "@/types/course";

// Utility function to add timeout to any promise
function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

export class DraftConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DraftConflictError';
    }
}

export interface CourseDraft {
    id: string;
    user_id: string;
    organization_id: string;
    draft_name?: string;
    step: number;
    course_data: CourseData;
    files_data: {
        name: string;
        size: number;
        type: string;
        lastModified: number;
        path?: string; // Storage path
        url?: string;  // Signed URL (optional, for frontend use)
    }[];
    created_at: string;
    updated_at: string;
}

export interface DraftSaveData {
    step: number;
    courseData: CourseData;
    files: File[];
}

class CourseDraftManager {
    private supabase = createClient();
    private currentDraftId: string | null = null;
    private autoSaveInterval: NodeJS.Timeout | null = null;
    private lastSaveData: string | null = null;
    private lastUpdatedAt: string | null = null; // For optimistic locking

    // Start auto-save functionality
    startAutoSave(getData: () => DraftSaveData, intervalMs: number = 30000) {
        this.stopAutoSave(); // Clear any existing interval

        this.autoSaveInterval = setInterval(async () => {
            try {
                const data = getData();
                await this.saveDraft(data);
            } catch (error) {
                console.error('Auto-save failed:', error);
            }
        }, intervalMs);
    }

    // Stop auto-save
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    // Save draft to database
    async saveDraft(data: DraftSaveData): Promise<{ success: boolean; draftId?: string; error?: string; conflict?: boolean }> {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                return { success: false, error: 'User not authenticated' };
            }

            const { data: userData } = await this.supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData?.organization_id) {
                return { success: false, error: 'Organization not found' };
            }

            // 1. Check for basic changes first (to avoid expensive file logic if not needed)
            const currentDataString = JSON.stringify({
                step: data.step,
                courseData: data.courseData,
                filesCount: data.files.length,
                // We add file names to change detection to catch file swaps
                fileNames: data.files.map(f => f.name).sort()
            });

            if (this.lastSaveData === currentDataString) {
                return { success: true, draftId: this.currentDraftId ?? undefined };
            }

            // 2. Draft ID and Initial Setup
            let draftId = this.currentDraftId;
            if (!draftId) {
                // If creating new, generate a UUID or let DB do it. 
                // We let DB do it on insert usually, but for file storage paths we might need an ID first.
                // Strategy: Insert a placeholder or use a random ID for the folder path.
                // Better Strategy: Insert the draft first if it doesn't exist.
            }

            // 3. Handle Files (Upload to Storage)
            // We need a stable ID for the folder path: {userId}/{draftId}/...
            // If we don't have a draftId yet, we can't upload files to the final folder.
            // But we can create the draft first with empty files, then upload, then update.
            // OR use a temporary client-side ID for the folder if we controlled the ID generation.

            // For now, simpler approach:
            // If no draftId, create the draft row first.
            if (!draftId) {
                const draftName = this.generateDraftName(data.courseData.title);
                const { data: newDraft, error: createError } = await this.supabase
                    .from('course_drafts')
                    .insert({
                        user_id: user.id,
                        organization_id: userData.organization_id,
                        draft_name: draftName,
                        step: data.step,
                        course_data: data.courseData,
                        files_data: [], // Empty initially
                    })
                    .select('id, updated_at')
                    .single();

                if (createError) throw createError;
                this.currentDraftId = newDraft.id;
                this.lastUpdatedAt = newDraft.updated_at;
                draftId = newDraft.id;
            } else {
                // **Optimistic Locking Check**
                // Fetch current server version to check if it has changed since we loaded it
                if (this.lastUpdatedAt) {
                    const { data: serverDraft } = await this.supabase
                        .from('course_drafts')
                        .select('updated_at')
                        .eq('id', draftId)
                        .single();

                    if (serverDraft && new Date(serverDraft.updated_at).getTime() > new Date(this.lastUpdatedAt).getTime()) {
                        // Server has newer data!
                        // In a real app, we might check *who* updated it. If it was us (auto-save), maybe fine.
                        // But for robustness, we warn.

                        // Exception: If the difference is very small (e.g. race condition), maybe ignore?
                        // For now, strict locking.
                        console.warn('Draft conflict detected. Server has newer version.');
                        return { success: false, conflict: true, error: "A newer version of this draft exists." };
                    }
                }
            }

            // Upload Files
            const filesData = await Promise.all(
                data.files.map(async (file) => {
                    // Check if file already uploaded (we need to track this, maybe via file name logic or metadata)
                    // For simplicity, we overwrite/re-upload or check if exists.
                    // To avoid re-uploading unchanged files, we'd need more complex state tracking.
                    // For now, robust implementation >> optimization. We upload.

                    const filePath = `${user.id}/${draftId}/${file.name}`;

                    // Upload to bucket
                    const { error: uploadError } = await this.supabase
                        .storage
                        .from('course-drafts')
                        .upload(filePath, file, {
                            upsert: true
                        });

                    if (uploadError) {
                        console.error('File upload failed:', uploadError);
                        // Fallback: throw? or skip?
                        throw uploadError;
                    }

                    return {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified,
                        path: filePath
                    };
                })
            );

            // 4. Update Draft Row
            const { data: updatedDraft, error: updateError } = await this.supabase
                .from('course_drafts')
                .update({
                    step: data.step,
                    course_data: data.courseData,
                    files_data: filesData,
                    draft_name: this.generateDraftName(data.courseData.title),
                    updated_at: new Date().toISOString()
                })
                .eq('id', draftId)
                .select('updated_at')
                .single();

            if (updateError) throw updateError;

            this.lastSaveData = currentDataString;
            this.lastUpdatedAt = updatedDraft.updated_at;

            return { success: true, draftId: this.currentDraftId ?? undefined };

        } catch (error: any) {
            console.error('Error saving draft:', error);
            return { success: false, error: error.message };
        }
    }

    private generateDraftName(title?: string) {
        if (title) return `${title} (Draft)`;
        const now = new Date();
        return `Draft - ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Load existing drafts (returns most recent one for auto-recovery)
    async loadDraft(): Promise<{ success: boolean; draft?: CourseDraft; error?: string }> {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) return { success: false, error: 'User not authenticated' };

            const { data: drafts, error } = await this.supabase
                .from('course_drafts')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (!drafts || drafts.length === 0) return { success: true };

            const draft = drafts[0];
            this.currentDraftId = draft.id;
            this.lastUpdatedAt = draft.updated_at;

            return { success: true, draft: draft as CourseDraft };

        } catch (error: any) {
            console.error('Error loading draft:', error);
            return { success: false, error: error.message };
        }
    }

    // Load all drafts for a user
    async loadAllDrafts(): Promise<{ success: boolean; drafts?: CourseDraft[]; error?: string }> {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) return { success: false, error: 'User not authenticated' };

            const { data: drafts, error } = await this.supabase
                .from('course_drafts')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (error) throw error;

            return { success: true, drafts: (drafts || []) as CourseDraft[] };

        } catch (error: any) {
            console.error('Error loading drafts:', error);
            return { success: false, error: error.message };
        }
    }

    // Convert draft files data back to File objects (Download from Storage)
    async restoreFilesFromDraft(filesData: CourseDraft['files_data']): Promise<File[]> {
        const files: File[] = [];

        for (const fileData of filesData) {
            try {
                // If path exists, download from storage
                if (fileData.path) {
                    const { data, error } = await this.supabase
                        .storage
                        .from('course-drafts')
                        .download(fileData.path);

                    if (error) {
                        console.error('Error downloading file:', fileData.path, error);
                        continue;
                    }

                    const file = new File([data], fileData.name, {
                        type: fileData.type,
                        lastModified: fileData.lastModified
                    });
                    files.push(file);

                } else if ((fileData as any).data) { // Legacy Base64 support
                    const blob = this.base64ToBlob((fileData as any).data, fileData.type);
                    const file = new File([blob], fileData.name, {
                        type: fileData.type,
                        lastModified: fileData.lastModified
                    });
                    files.push(file);
                }
            } catch (error) {
                console.error('Error restoring file:', fileData.name, error);
            }
        }

        return files;
    }

    // Delete draft
    async deleteDraft(draftId?: string): Promise<{ success: boolean; error?: string }> {
        const idToDelete = draftId || this.currentDraftId;
        if (!idToDelete) return { success: true };

        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) return { success: false, error: 'User not authenticated' };

            // 1. Delete files from storage
            // Logic: List files in the folder {user.id}/{idToDelete} and delete them
            const folderPath = `${user.id}/${idToDelete}`;
            const { data: files } = await this.supabase
                .storage
                .from('course-drafts')
                .list(folderPath);

            if (files && files.length > 0) {
                const pathsToDelete = files.map(f => `${folderPath}/${f.name}`);
                await this.supabase.storage.from('course-drafts').remove(pathsToDelete);
            }

            // 2. Delete row
            const { error } = await this.supabase
                .from('course_drafts')
                .delete()
                .eq('id', idToDelete)
                .eq('user_id', user.id);

            if (error) throw error;

            if (idToDelete === this.currentDraftId) {
                this.currentDraftId = null;
                this.lastSaveData = null;
                this.lastUpdatedAt = null;
            }

            return { success: true };

        } catch (error: any) {
            console.error('Error deleting draft:', error);
            return { success: false, error: error.message };
        }
    }

    // Get current draft ID
    getCurrentDraftId(): string | null {
        return this.currentDraftId;
    }

    // Set current draft ID 
    setCurrentDraftId(draftId: string | null) {
        this.currentDraftId = draftId;
        // Important: When setting ID manually, we should ideally fetch the update_at from DB 
        // to sync locking state, but usually this is called after loading so it might be fine.
        // For robustness, if we wanted to be 100% sure, we'd fetch.
    }

    // For handling conflicts - manual override
    async forceSave(data: DraftSaveData) {
        // Reset lastUpdatedAt to null or latest to bypass check?
        // Actually, we should fetch latest updated_at from DB, update our local state, then save.
        // OR just simple strategy: clear lastUpdatedAt to indicate "I don't care, overwrite".
        // But the check compares if server > local. If we set local = server, it passes.
        // Or if we implemented a 'force' flag in saveDraft.

        // Simpler: Just update lastUpdatedAt to a future date? No.
        // Let's refetch the latest timestamp, update our local state, then save.
        if (this.currentDraftId) {
            const { data: serverDraft } = await this.supabase
                .from('course_drafts')
                .select('updated_at')
                .eq('id', this.currentDraftId)
                .single();
            if (serverDraft) {
                this.lastUpdatedAt = serverDraft.updated_at;
            }
        }
        return this.saveDraft(data);
    }

    // Create a new draft
    createNewDraft() {
        this.currentDraftId = null;
        this.lastSaveData = null;
        this.lastUpdatedAt = null;
    }

    // Utility: Convert base64 to Blob (Legacy Support)
    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    cleanup() {
        this.stopAutoSave();
    }
}

export const courseDraftManager = new CourseDraftManager();
