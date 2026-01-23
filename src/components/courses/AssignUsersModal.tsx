"use client";

import { useState, useEffect } from "react";
import { X, Search, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AssignUsersModalProps {
    isOpen: boolean;
    onClose: () => void;
    courseId: string;
    onAssignmentComplete: () => void;
}

interface User {
    id: string;
    full_name: string;
    email: string;
    role: string;
    isAssigned: boolean;
}

export default function AssignUsersModal({ isOpen, onClose, courseId, onAssignmentComplete }: AssignUsersModalProps) {
    const [activeTab, setActiveTab] = useState<'select' | 'invite'>('select');
    const [inviteEmails, setInviteEmails] = useState("");
    const [inviting, setInviting] = useState(false);

    const [users, setUsers] = useState<User[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const supabase = createClient();

    useEffect(() => {
        if (isOpen) {
            loadUsers();
        }
    }, [isOpen, courseId]);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            // Get all users in organization, excluding admins
            const { data: orgUsers } = await supabase
                .from("users")
                .select("id, full_name, email, role")
                .eq("organization_id", userData?.organization_id)
                .neq("role", "admin");  // Exclude admin users

            // Get existing assignments for this course
            const { data: assignments } = await supabase
                .from("course_assignments")
                .select("worker_id")
                .eq("course_id", courseId);

            const assignedUserIds = new Set(assignments?.map(a => a.worker_id) || []);

            const usersWithStatus = (orgUsers || []).map(u => ({
                ...u,
                isAssigned: assignedUserIds.has(u.id),
            }));

            setUsers(usersWithStatus);
        } catch (error) {
            console.error("Error loading users:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleUser = (userId: string) => {
        const newSelected = new Set(selectedUsers);
        if (newSelected.has(userId)) {
            newSelected.delete(userId);
        } else {
            newSelected.add(userId);
        }
        setSelectedUsers(newSelected);
    };

    const handleAssign = async () => {
        if (selectedUsers.size === 0) return;

        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;


            // Get course details first
            const { data: courseData, error: courseError } = await supabase
                .from("courses")
                .select("title")
                .eq("id", courseId)
                .single();

            if (courseError) throw courseError;

            // Get organization name
            const { data: userData } = await supabase
                .from("users")
                .select("organization:organizations(name)")
                .eq("id", user.id)
                .single();

            const organizationName = (userData?.organization as any)?.name || "Your Organization";

            // Calculate deadline (30 days from now)
            const deadline = new Date();
            deadline.setDate(deadline.getDate() + 30);
            const deadlineString = deadline.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });

            const assignments = Array.from(selectedUsers).map(userId => ({
                course_id: courseId,
                worker_id: userId,
                assigned_by: user.id,
                status: "not_started",
                assigned_at: new Date().toISOString(),
                deadline: deadline.toISOString(),
            }));

            const { error } = await supabase
                .from("course_assignments")
                .insert(assignments);

            if (error) throw error;

            // Send email notifications to assigned users
            const selectedUserObjects = users.filter(u => selectedUsers.has(u.id));

            // Prepare assignment data for email notifications
            const assignmentData = selectedUserObjects.map(user => ({
                userId: user.id,
                userEmail: user.email,
                userName: user.full_name,
                courseTitle: courseData.title,
                organizationName,
                courseId,
                deadline: deadlineString,
            }));

            // Send notifications via server action (don't block on email failures)
            try {
                const { sendCourseAssignmentNotifications } = await import("@/app/actions/course");
                await sendCourseAssignmentNotifications(assignmentData);
            } catch (emailError) {
                console.error("Failed to send email notifications:", emailError);
                // Don't fail the entire operation if email fails
            }

            onAssignmentComplete();
            onClose();
        } catch (error) {
            console.error("Error creating assignments:", error);
            alert("Failed to assign users. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const filteredUsers = searchQuery
        ? users.filter(u =>
            u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : users;

    const unassignedUsers = filteredUsers.filter(u => !u.isAssigned);

    const handleInvite = async () => {
        if (!inviteEmails.trim()) return;

        setInviting(true);
        try {
            const emails = inviteEmails
                .split(/[\n,]/)
                .map(e => e.trim())
                .filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

            if (emails.length === 0) {
                alert("Please enter valid email addresses.");
                setInviting(false);
                return;
            }

            // Dynamic import to avoid client-side bundling issues with server actions if directly imported sometimes
            const { inviteUsersToCourse } = await import("@/app/actions/course-invitations");

            const result = await inviteUsersToCourse(emails, courseId);

            if (result.totalFailed === 0) {
                alert(`Successfully invited ${result.totalSuccess} user(s)!`);
                onAssignmentComplete();
                onClose();
            } else {
                const failedEmails = result.results.filter(r => !r.success).map(r => r.email).join(", ");
                alert(`Invited ${result.totalSuccess} user(s). Failed to invite: ${failedEmails}`);
                if (result.totalSuccess > 0) {
                    onAssignmentComplete();
                }
            }
        } catch (error) {
            console.error("Error inviting users:", error);
            alert("Failed to send invitations. Please try again.");
        } finally {
            setInviting(false);
        }
    };

    // ... filteredUsers existing code ...

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div className="fixed inset-0 transition-opacity" style={{ backgroundColor: '#23232399' }} onClick={onClose}></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full">
                    {/* Header */}
                    <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-bold text-slate-900">Assign Course</h2>
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                <button
                                    onClick={() => setActiveTab('select')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'select' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    Select Users
                                </button>
                                <button
                                    onClick={() => setActiveTab('invite')}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'invite' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                >
                                    Invite by Email
                                </button>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-600" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-6 py-6">
                        {activeTab === 'select' ? (
                            <>
                                {/* Search */}
                                <div className="mb-4">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Search users by name or email..."
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        />
                                    </div>
                                </div>

                                {/* User List */}
                                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                                    {loading ? (
                                        <div className="p-8 text-center text-slate-600">Loading users...</div>
                                    ) : unassignedUsers.length === 0 ? (
                                        <div className="p-8 text-center text-slate-600">
                                            {searchQuery ? "No users found matching your search" : "All users are already assigned to this course"}
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-gray-200">
                                            {unassignedUsers.map(user => (
                                                <label
                                                    key={user.id}
                                                    className="flex items-center gap-4 p-4 hover:bg-white cursor-pointer transition-colors"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedUsers.has(user.id)}
                                                        onChange={() => handleToggleUser(user.id)}
                                                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                                    />
                                                    <div className="flex-1">
                                                        <p className="font-medium text-slate-900">{user.full_name}</p>
                                                        <p className="text-sm text-slate-500">{user.email}</p>
                                                    </div>
                                                    <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded">
                                                        {user.role}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Selected Count */}
                                {selectedUsers.size > 0 && (
                                    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                                        <p className="text-sm text-indigo-800">
                                            <span className="font-semibold">{selectedUsers.size}</span> user{selectedUsers.size !== 1 ? "s" : ""} selected
                                        </p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Email Addresses (one per line or comma separated)
                                    </label>
                                    <textarea
                                        value={inviteEmails}
                                        onChange={(e) => setInviteEmails(e.target.value)}
                                        placeholder="colleague@example.com&#10;new-hire@example.com"
                                        className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                                    />
                                    <p className="text-xs text-slate-500 mt-2">
                                        Note: We will send an email to these addresses with a secure link to access the course immediately without login.
                                        If they don't have an account, one will be created for them automatically.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            disabled={saving || inviting}
                        >
                            Cancel
                        </button>

                        {activeTab === 'select' ? (
                            <button
                                onClick={handleAssign}
                                disabled={selectedUsers.size === 0 || saving}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {saving ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Assigning...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        Assign Users
                                    </>
                                )}
                            </button>
                        ) : (
                            <button
                                onClick={handleInvite}
                                disabled={!inviteEmails.trim() || inviting}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {inviting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Sending Invitations...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        Send Invitations
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
