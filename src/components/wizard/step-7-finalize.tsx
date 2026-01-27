"use client";

import { useState, useEffect, useRef } from "react";
import { Check, X, Calendar, Clock, Plus, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";

interface Step7FinalizeProps {
    onPublish: (data: PublishData) => void;
    onBack: () => void;
    isPublishing?: boolean;
}

export interface PublishData {
    assignType: "specific" | "all";
    selectedUserIds: string[];
    emailInvites: string[];
    deadline?: {
        enabled: boolean;
        dueDate: string;
        dueTime: string;
        reminders: number[]; // minutes before
    };
}

interface UserProfile {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    avatar_url?: string;
    role?: string;
}

export function Step7Finalize({ onPublish, onBack, isPublishing = false }: Step7FinalizeProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<UserProfile[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [emailInvites, setEmailInvites] = useState<string[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Deadline State
    const [deadlineEnabled, setDeadlineEnabled] = useState(false);
    const [dueDate, setDueDate] = useState("");
    const [dueTime, setDueTime] = useState("");
    const [reminders, setReminders] = useState<number[]>([]); // Default no reminders, user adds them

    const supabase = createClient();
    const searchTimeout = useRef<NodeJS.Timeout>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);

    // Search Users
    useEffect(() => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        setIsSearching(true);
        searchTimeout.current = setTimeout(async () => {
            try {
                // Determine if we are searching for emails or names
                let query = supabase
                    .from("users")
                    .select("id, first_name, last_name, email, role, avatar_url")
                    .limit(5);

                // Simple search logic
                query = query.or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);

                const { data, error } = await query;
                if (!error && data) {
                    // Filter out already selected users
                    const filtered = data.filter(u => !selectedUsers.find(s => s.id === u.id));
                    setSearchResults(filtered);
                }
            } catch (error) {
                console.error("Error searching users:", error);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimeout.current) clearTimeout(searchTimeout.current);
        };
    }, [searchQuery, selectedUsers]);

    const handleSelectUser = (user: UserProfile) => {
        setSelectedUsers([...selectedUsers, user]);
        setSearchQuery("");
        setSearchResults([]);
    };

    const handleRemoveUser = (userId: string) => {
        setSelectedUsers(selectedUsers.filter(u => u.id !== userId));
    };

    const handleInviteEmail = () => {
        if (!inviteEmail || !inviteEmail.includes("@")) return;

        // Split by comma if multiple
        const emails = inviteEmail.split(",").map(e => e.trim()).filter(e => e);
        const newEmails = emails.filter(e => !emailInvites.includes(e));

        if (newEmails.length > 0) {
            setEmailInvites([...emailInvites, ...newEmails]);
            setInviteEmail("");
        }
    };

    const handleRemoveEmail = (email: string) => {
        setEmailInvites(emailInvites.filter(e => e !== email));
    };

    const handlePublishClick = () => {
        onPublish({
            assignType: selectedUsers.length > 0 || emailInvites.length > 0 ? "specific" : "all", // Logic can be refined
            selectedUserIds: selectedUsers.map(u => u.id),
            emailInvites,
            deadline: deadlineEnabled ? {
                enabled: true,
                dueDate,
                dueTime,
                reminders
            } : undefined
        });
    };

    // Close search results when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
                setSearchResults([]);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className="max-w-3xl mx-auto py-8">
            <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">Assigning & Publish</h2>
                <p className="text-slate-500">
                    Select which staff should take this course, set deadlines, and finalize publishing.
                </p>
            </div>

            <div className="bg-white border border-blue-500/30 rounded-xl shadow-sm p-8 space-y-8 relative overflow-hidden">
                {/* Decorative top border similar to screenshot if needed, styling simple first */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>

                {/* Assign To Section */}
                <div className="space-y-4">
                    <label className="block text-sm font-semibold text-slate-700">Assign To</label>
                    <div
                        ref={searchContainerRef}
                        className="relative min-h-[50px] border border-blue-200 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all bg-white"
                    >
                        <div className="flex flex-wrap gap-2">
                            {/* Selected Users Chips */}
                            {selectedUsers.map(user => (
                                <div key={user.id} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2 border border-blue-100">
                                    <div className="w-5 h-5 rounded-full bg-blue-200 flex items-center justify-center text-xs overflow-hidden">
                                        {user.avatar_url ? (
                                            <img src={user.avatar_url} alt={user.first_name} className="w-full h-full object-cover" />
                                        ) : (
                                            <span>{user.first_name[0]}</span>
                                        )}
                                    </div>
                                    {user.first_name} {user.last_name}
                                    <button onClick={() => handleRemoveUser(user.id)} className="hover:text-blue-900">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}

                            {/* Search Input */}
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={selectedUsers.length === 0 ? "Add people, emails or names" : ""}
                                className="flex-1 min-w-[150px] outline-none text-sm py-1.5 px-1 bg-transparent placeholder:text-slate-400"
                            />
                        </div>

                        {/* Search Results Dropdown */}
                        {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-lg shadow-xl z-20 max-h-[300px] overflow-y-auto">
                                {searchResults.map(user => (
                                    <button
                                        key={user.id}
                                        onClick={() => handleSelectUser(user)}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors border-b border-gray-50 last:border-0"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 overflow-hidden shrink-0">
                                            {user.avatar_url ? (
                                                <img src={user.avatar_url} alt={user.first_name} className="w-full h-full object-cover" />
                                            ) : (
                                                <User className="w-4 h-4" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">{user.first_name} {user.last_name}</p>
                                            <p className="text-xs text-slate-500">{user.email} • {user.role || 'Staff'}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Email Invite Section */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Enter team member email</label>
                    <p className="text-xs text-slate-400">Enter one or more emails to invite to your course.</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="Emails, comma separated"
                            className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-sans"
                            onKeyDown={(e) => e.key === 'Enter' && handleInviteEmail()}
                        />
                        <button
                            onClick={handleInviteEmail}
                            className="bg-[#4E61F6] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#4E61F6]/90 transition-colors"
                        >
                            Invite
                        </button>
                    </div>
                    {/* Display Added Emails */}
                    {emailInvites.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            {emailInvites.map(email => (
                                <div key={email} className="bg-gray-100 text-slate-700 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 border border-gray-200">
                                    {email}
                                    <button onClick={() => handleRemoveEmail(email)} className="hover:text-slate-900">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Deadline Section */}
                <div className="pt-4 border-t border-gray-100 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900">Set Completion Deadline</label>
                            <p className="text-xs text-slate-500 mt-1">Set a deadline for team member to complete this course</p>
                        </div>

                        {/* Toggle Switch */}
                        <button
                            onClick={() => setDeadlineEnabled(!deadlineEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${deadlineEnabled ? 'bg-[#4E61F6]' : 'bg-gray-200'
                                }`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${deadlineEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`} />
                        </button>
                    </div>

                    {deadlineEnabled && (
                        <div className="grid grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-slate-400" /> Due date
                                </label>
                                <input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-600"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-slate-400" /> Due time
                                </label>
                                <input
                                    type="time"
                                    value={dueTime}
                                    onChange={(e) => setDueTime(e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-600"
                                />
                            </div>

                            {/* Reminders - Simplification based on screenshot showing "30 minutes before" */}
                            <div className="col-span-2">
                                <div className="flex items-center justify-between py-3 border-b border-gray-50">
                                    <div className="flex items-center gap-3">
                                        <Clock className="w-4 h-4 text-slate-400" />
                                        <span className="text-sm font-medium text-slate-700">30 minutes before</span>
                                    </div>
                                    <button className="text-slate-400 hover:text-slate-600">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <button className="mt-4 text-sm text-slate-400 hover:text-[#4E61F6] font-medium flex items-center gap-2 transition-colors">
                                    Add reminder
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Assigned To Thumbnails (Bottom Center in screenshot - skipping for now or adding pure decor) */}
                {/* The screenshot shows a small user bubble `TM`. We can show selected users here if we want, but chips are better. */}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between mt-12 pt-8 border-t border-gray-100">
                <button
                    onClick={onBack}
                    disabled={isPublishing}
                    className="px-8 py-3 border border-gray-200 rounded-lg text-slate-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-[120px]"
                >
                    Back
                </button>
                <button
                    onClick={handlePublishClick}
                    disabled={isPublishing}
                    className="px-8 py-3 bg-[#4E61F6] text-white font-medium rounded-lg hover:bg-[#4E61F6]/90 shadow-lg shadow-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 w-[200px]"
                >
                    {isPublishing ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Publishing...
                        </>
                    ) : (
                        "Publish Course"
                    )}
                </button>
            </div>
        </div>
    );
}
