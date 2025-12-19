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
        data?: string; // Base64 encoded file data
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
    async saveDraft(data: DraftSaveData): Promise<{ success: boolean; draftId?: string; error?: string }> {
        try {
            console.log('Starting draft save process...');
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                console.error('User not authenticated');
                return { success: false, error: 'User not authenticated' };
            }
            console.log('User authenticated:', user.id);

            const { data: userData } = await this.supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            if (!userData?.organization_id) {
                return { success: false, error: 'Organization not found' };
            }

            // Convert files to serializable format
            const filesData = await Promise.all(
                data.files.map(async (file) => {
                    try {
                        const base64Data = await this.fileToBase64(file);
                        return {
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified,
                            data: base64Data
                        };
                    } catch (error) {
                        console.error('Error converting file to base64:', error);
                        return {
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            lastModified: file.lastModified
                        };
                    }
                })
            );

            // Check if data has changed to avoid unnecessary saves
            const currentDataString = JSON.stringify({ 
                step: data.step, 
                courseData: data.courseData, 
                filesCount: data.files.length 
            });
            
            if (this.lastSaveData === currentDataString) {
                return { success: true, draftId: this.currentDraftId ?? undefined };
            }

            // Generate draft name if not provided
            const generateDraftName = () => {
                const title = data.courseData.title;
                if (title) {
                    return `${title} (Draft)`;
                }
                const now = new Date();
                return `Draft - ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            };

            const draftData = {
                user_id: user.id,
                organization_id: userData.organization_id,
                draft_name: generateDraftName(),
                step: data.step,
                course_data: data.courseData,
                files_data: filesData,
                updated_at: new Date().toISOString()
            };

            let result: any;
            
            if (this.currentDraftId) {
                // Update existing draft
                console.log('Updating existing draft:', this.currentDraftId);
                result = await withTimeout(
                    this.supabase
                        .from('course_drafts')
                        .update(draftData)
                        .eq('id', this.currentDraftId)
                        .eq('user_id', user.id)
                        .select('id')
                        .single()
                        .then(res => res),
                    10000 // 10 second timeout
                );
                console.log('Update result:', result);
            } else {
                // Create new draft
                console.log('Creating new draft');
                result = await withTimeout(
                    this.supabase
                        .from('course_drafts')
                        .insert({
                            ...draftData,
                            created_at: new Date().toISOString()
                        })
                        .select('id')
                        .single()
                        .then(res => res),
                    10000 // 10 second timeout
                );
                console.log('Insert result:', result);
            }

            if (result.error) {
                console.error('Database error:', result.error);
                return { success: false, error: result.error.message };
            }

            this.currentDraftId = result.data.id;
            this.lastSaveData = currentDataString;
            
            console.log('Draft saved successfully:', this.currentDraftId);
            console.log('Save operation completed successfully');
            return { success: true, draftId: this.currentDraftId ?? undefined };

        } catch (error: any) {
            console.error('Error saving draft:', error);
            return { success: false, error: error.message };
        }
    }

    // Load existing drafts (returns most recent one for auto-recovery)
    async loadDraft(): Promise<{ success: boolean; draft?: CourseDraft; error?: string }> {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                return { success: false, error: 'User not authenticated' };
            }

            const { data: drafts, error } = await this.supabase
                .from('course_drafts')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (error) {
                console.error('Error loading draft:', error);
                return { success: false, error: error.message };
            }

            if (!drafts || drafts.length === 0) {
                // No drafts found
                return { success: true };
            }

            const draft = drafts[0];
            this.currentDraftId = draft.id;
            return { success: true, draft };

        } catch (error: any) {
            console.error('Error loading draft:', error);
            return { success: false, error: error.message };
        }
    }

    // Load all drafts for a user
    async loadAllDrafts(): Promise<{ success: boolean; drafts?: CourseDraft[]; error?: string }> {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                return { success: false, error: 'User not authenticated' };
            }

            const { data: drafts, error } = await this.supabase
                .from('course_drafts')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('Error loading drafts:', error);
                return { success: false, error: error.message };
            }

            return { success: true, drafts: drafts || [] };

        } catch (error: any) {
            console.error('Error loading drafts:', error);
            return { success: false, error: error.message };
        }
    }

    // Convert draft files data back to File objects
    async restoreFilesFromDraft(filesData: CourseDraft['files_data']): Promise<File[]> {
        const files: File[] = [];
        
        for (const fileData of filesData) {
            try {
                if (fileData.data) {
                    const blob = this.base64ToBlob(fileData.data, fileData.type);
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
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                return { success: false, error: 'User not authenticated' };
            }

            const idToDelete = draftId || this.currentDraftId;
            if (!idToDelete) {
                return { success: true }; // No draft to delete
            }

            const { error } = await this.supabase
                .from('course_drafts')
                .delete()
                .eq('id', idToDelete)
                .eq('user_id', user.id);

            if (error) {
                console.error('Error deleting draft:', error);
                return { success: false, error: error.message };
            }

            if (idToDelete === this.currentDraftId) {
                this.currentDraftId = null;
                this.lastSaveData = null;
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

    // Set current draft ID (for loading existing drafts)
    setCurrentDraftId(draftId: string | null) {
        this.currentDraftId = draftId;
    }

    // Create a new draft (don't update existing one)
    createNewDraft() {
        this.currentDraftId = null;
        this.lastSaveData = null;
    }

    // Utility: Convert File to base64
    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = error => reject(error);
        });
    }

    // Utility: Convert base64 to Blob
    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    // Cleanup on unmount
    cleanup() {
        this.stopAutoSave();
    }
}

// Export singleton instance
export const courseDraftManager = new CourseDraftManager();
