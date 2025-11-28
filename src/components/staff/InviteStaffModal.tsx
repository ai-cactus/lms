"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface InviteStaffModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInviteComplete: () => void;
}

interface StaffMember {
    fullName: string;
    email: string;
}

export default function InviteStaffModal({ isOpen, onClose, onInviteComplete }: InviteStaffModalProps) {
    const [staffMembers, setStaffMembers] = useState<StaffMember[]>([{ fullName: "", email: "" }]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const supabase = createClient();

    const handleAddRow = () => {
        setStaffMembers([...staffMembers, { fullName: "", email: "" }]);
    };

    const handleRemoveRow = (index: number) => {
        if (staffMembers.length > 1) {
            setStaffMembers(staffMembers.filter((_, i) => i !== index));
        }
    };

    const handleChange = (index: number, field: keyof StaffMember, value: string) => {
        const updated = [...staffMembers];
        updated[index][field] = value;
        setStaffMembers(updated);
    };

    const handleInvite = async () => {
        // Validate
        const validMembers = staffMembers.filter(m => m.email.trim() && m.fullName.trim());

        if (validMembers.length === 0) {
            setError("Please enter at least one staff member with both name and email");
            return;
        }

        // Check for invalid emails
        const invalidEmails = validMembers.filter(m => !m.email.includes("@"));
        if (invalidEmails.length > 0) {
            setError("Please enter valid email addresses");
            return;
        }

        setSending(true);
        setError("");

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data: adminData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            // Send invitations for each staff member
            const results = await Promise.all(
                validMembers.map(async (member) => {
                    try {
                        // Generate temporary password
                        const tempPassword = Math.random().toString(36).slice(-12) + "Aa1!";

                        // Create user account with Supabase Auth
                        const { data, error: signUpError } = await supabase.auth.signUp({
                            email: member.email,
                            password: tempPassword,
                            options: {
                                emailRedirectTo: `${window.location.origin}/auth/callback`,
                                data: {
                                    organization_id: adminData?.organization_id,
                                    role: "worker",
                                    full_name: member.fullName,
                                }
                            }
                        });

                        if (signUpError) throw signUpError;

                        // Create user record in users table
                        if (data.user) {
                            await supabase.from("users").insert({
                                id: data.user.id,
                                email: member.email,
                                full_name: member.fullName,
                                role: "worker",
                                organization_id: adminData?.organization_id,
                            });

                            // Send password reset email so they can set their own password
                            await supabase.auth.resetPasswordForEmail(member.email, {
                                redirectTo: `${window.location.origin}/auth/reset-password`,
                            });
                        }

                        return { email: member.email, success: true };
                    } catch (err: any) {
                        console.error(`Error inviting ${member.email}:`, err);
                        return { email: member.email, success: false, error: err.message };
                    }
                })
            );

            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            if (failed > 0) {
                setError(`${successful} invitation(s) sent, ${failed} failed`);
            } else {
                onInviteComplete();
                onClose();
                setStaffMembers([{ fullName: "", email: "" }]);
            }

            setSending(false);
        } catch (err: any) {
            console.error("Error sending invitations:", err);
            setError(err.message || "Failed to send invitations");
            setSending(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose}></div>

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    {/* Header */}
                    <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 bg-white">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">Add Staff Members</h2>
                            <p className="text-sm text-slate-500 mt-1">Enter staff details to send invitations</p>
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
                        <div className="space-y-3 mb-4">
                            {staffMembers.map((member, index) => (
                                <div key={index} className="flex gap-3 items-start">
                                    <input
                                        type="text"
                                        value={member.fullName}
                                        onChange={(e) => handleChange(index, "fullName", e.target.value)}
                                        placeholder="Full Name"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        disabled={sending}
                                    />
                                    <input
                                        type="email"
                                        value={member.email}
                                        onChange={(e) => handleChange(index, "email", e.target.value)}
                                        placeholder="Email"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        disabled={sending}
                                    />
                                    {staffMembers.length > 1 && (
                                        <button
                                            onClick={() => handleRemoveRow(index)}
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            disabled={sending}
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={handleAddRow}
                            className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium text-sm"
                            disabled={sending}
                        >
                            <Plus className="w-4 h-4" />
                            Add Another
                        </button>

                        {error && (
                            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}

                        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                                <span className="font-semibold">Note:</span> Invited staff members will receive an email to set their password and access the platform.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3 sticky bottom-0 bg-white">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            disabled={sending}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleInvite}
                            disabled={sending}
                            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {sending ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Sending Invitations...
                                </>
                            ) : (
                                "Send Invitations"
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
