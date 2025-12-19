"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNotification } from "@/contexts/notification-context";
import { CourseDraft, courseDraftManager } from "@/lib/course-draft";
import { FilePdf, FileDoc, Trash, Clock, Play, PencilSimple } from "@phosphor-icons/react";

interface CourseDraftsProps {
    onContinueDraft: (draft: CourseDraft) => void;
}

export function CourseDrafts({ onContinueDraft }: CourseDraftsProps) {
    const [drafts, setDrafts] = useState<CourseDraft[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const supabase = createClient();
    const { showNotification } = useNotification();

    useEffect(() => {
        loadDrafts();
    }, []);

    const loadDrafts = async () => {
        try {
            setLoading(true);
            const result = await courseDraftManager.loadAllDrafts();
            
            if (result.success) {
                setDrafts(result.drafts || []);
            } else {
                console.error('Error loading drafts:', result.error);
                showNotification('error', 'Failed to load drafts');
            }
        } catch (error) {
            console.error('Error loading drafts:', error);
            showNotification('error', 'Failed to load drafts');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteDraft = async (draftId: string) => {
        if (deletingId) return;
        
        if (!confirm('Are you sure you want to delete this draft? This action cannot be undone.')) {
            return;
        }

        try {
            setDeletingId(draftId);
            const result = await courseDraftManager.deleteDraft(draftId);
            
            if (result.success) {
                setDrafts(prev => prev.filter(draft => draft.id !== draftId));
                showNotification('success', 'Draft deleted successfully');
            } else {
                showNotification('error', 'Failed to delete draft');
            }
        } catch (error) {
            console.error('Error deleting draft:', error);
            showNotification('error', 'Failed to delete draft');
        } finally {
            setDeletingId(null);
        }
    };

    const handleStartRename = (draft: CourseDraft) => {
        setRenamingId(draft.id);
        setNewName(draft.draft_name || draft.course_data.title || 'Untitled Course');
    };

    const handleCancelRename = () => {
        setRenamingId(null);
        setNewName('');
    };

    const handleSaveRename = async (draftId: string) => {
        if (!newName.trim()) return;

        try {
            const { error } = await supabase
                .from('course_drafts')
                .update({ draft_name: newName.trim() })
                .eq('id', draftId);

            if (error) {
                console.error('Error renaming draft:', error);
                showNotification('error', 'Failed to rename draft');
                return;
            }

            setDrafts(prev => prev.map(draft => 
                draft.id === draftId 
                    ? { ...draft, draft_name: newName.trim() }
                    : draft
            ));
            
            showNotification('success', 'Draft renamed successfully');
            handleCancelRename();
        } catch (error) {
            console.error('Error renaming draft:', error);
            showNotification('error', 'Failed to rename draft');
        }
    };

    const getStepName = (step: number) => {
        const stepNames = {
            1: 'Category Selection',
            2: 'Document Upload',
            3: 'Course Details',
            4: 'Quiz Configuration',
            5: 'Content Review',
            6: 'Quiz Review',
            7: 'Finalization'
        };
        return stepNames[step as keyof typeof stepNames] || `Step ${step}`;
    };

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
        
        if (diffInHours < 1) {
            const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
            return diffInMinutes < 1 ? 'Just now' : `${diffInMinutes}m ago`;
        } else if (diffInHours < 24) {
            return `${diffInHours}h ago`;
        } else {
            const diffInDays = Math.floor(diffInHours / 24);
            return `${diffInDays}d ago`;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4E61F6]"></div>
            </div>
        );
    }

    if (drafts.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock size={24} className="text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-2">No drafts found</h3>
                <p className="text-slate-500 mb-6">
                    Start creating a course and your progress will be automatically saved as drafts.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Course Drafts ({drafts.length})</h2>
                <button
                    onClick={loadDrafts}
                    className="text-sm text-[#4E61F6] hover:text-[#4E61F6]/80 font-medium"
                >
                    Refresh
                </button>
            </div>

            <div className="grid gap-4">
                {drafts.map((draft) => (
                    <div
                        key={draft.id}
                        className="bg-white border border-gray-200 rounded-lg p-6 hover:border-gray-300 transition-colors"
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                            <Clock size={16} className="text-blue-600" />
                                        </div>
                                        <div className="flex-1">
                                            {renamingId === draft.id ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={newName}
                                                        onChange={(e) => setNewName(e.target.value)}
                                                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-semibold"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSaveRename(draft.id);
                                                            if (e.key === 'Escape') handleCancelRename();
                                                        }}
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => handleSaveRename(draft.id)}
                                                        className="px-2 py-1 bg-[#4E61F6] text-white rounded text-xs hover:bg-[#4E61F6]/90"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={handleCancelRename}
                                                        className="px-2 py-1 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1">
                                                        <h3 className="font-semibold text-slate-900">
                                                            {draft.draft_name || draft.course_data.title || 'Untitled Course'}
                                                        </h3>
                                                        <p className="text-sm text-slate-500">
                                                            {getStepName(draft.step)} • {formatTimeAgo(draft.updated_at)}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleStartRename(draft)}
                                                        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                                                        title="Rename draft"
                                                    >
                                                        <PencilSimple size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {draft.course_data.category && (
                                    <div className="mb-3">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                            {draft.course_data.category}
                                        </span>
                                    </div>
                                )}

                                {draft.files_data && draft.files_data.length > 0 && (
                                    <div className="mb-4">
                                        <p className="text-sm text-slate-600 mb-2">
                                            {draft.files_data.length} file{draft.files_data.length > 1 ? 's' : ''} attached:
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {draft.files_data.slice(0, 3).map((file, index) => (
                                                <div key={index} className="flex items-center gap-1 text-xs text-slate-500 bg-gray-50 px-2 py-1 rounded">
                                                    {file.name.endsWith('.pdf') ? (
                                                        <FilePdf size={14} className="text-red-500" />
                                                    ) : (
                                                        <FileDoc size={14} className="text-blue-500" />
                                                    )}
                                                    <span className="truncate max-w-24">{file.name}</span>
                                                </div>
                                            ))}
                                            {draft.files_data.length > 3 && (
                                                <span className="text-xs text-slate-400 px-2 py-1">
                                                    +{draft.files_data.length - 3} more
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-4">
                                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-[#4E61F6] h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${(draft.step / 7) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-slate-500 font-medium">
                                        {Math.round((draft.step / 7) * 100)}%
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 ml-4">
                                <button
                                    onClick={() => onContinueDraft(draft)}
                                    className="flex items-center gap-2 px-4 py-2 bg-[#4E61F6] text-white rounded-lg font-medium hover:bg-[#4E61F6]/90 transition-colors"
                                >
                                    <Play size={16} weight="fill" />
                                    Continue
                                </button>
                                <button
                                    onClick={() => handleDeleteDraft(draft.id)}
                                    disabled={deletingId === draft.id}
                                    className="flex items-center justify-center w-10 h-10 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {deletingId === draft.id ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                                    ) : (
                                        <Trash size={16} />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
