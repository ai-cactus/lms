"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface InviteStaffModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInviteComplete: () => void;
}

export default function InviteStaffModal({ isOpen, onClose, onInviteComplete }: InviteStaffModalProps) {
    const [emails, setEmails] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const supabase = createClient();

    const handleInvite = async () => {
        if (!emails.trim()) {
            setError("Please enter at least one email address");
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

            // Split and clean email addresses
            const emailList = emails
                .split(",")
                .map(e => e.trim())
                .filter(e => e.length > 0 && e.includes("@"));

            if (emailList.length === 0) {
                setError("Please enter valid email addresses");
                setSending(false);
                return;
            }

            // Send invitations for each email
            const results = await Promise.all(
                emailList.map(async (email) => {
                    try {
                        // Create user account with Supabase Auth
                        // This will send an invitation email automatically
                        const { data, error: signUpError } = await supabase.auth.signUp({
                            email,
                            password: Math.random().toString(36).slice(-12) + "Aa1!", // Temporary password
                            options: {
                                emailRedirectTo: `${window.location.origin}/auth/callback`,
                                data: {
                                    organization_id: adminData?.organization_id,
                                    role: "worker",
                                }
                            }
                        });

                        if (signUpError) throw signUpError;

                        // Create user record in users table
                        if (data.user) {
                            await supabase.from("users").insert({
                                id: data.user.id,
                                email,
                                full_name: email.split("@")[0], // Temporary name
                                role: "worker",
                                organization_id: adminData?.organization_id,
                            });
                        }

                        return { email, success: true };
                    } catch (err: any) {
                        console.error(`Error inviting ${email}:`, err);
                        return { email, success: false, error: err.message };
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
                setEmails("");
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
                <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full">
                    {/* Header */}
                    <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">Enter team member email</h2>
                            <p className="text-sm text-slate-500 mt-1">Enter one or more emails to invite to your course.</p>
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
                        <div className="mb-4">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={emails}
                                    onChange={(e) => setEmails(e.target.value)}
                                    placeholder="Emails, comma separated"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                    disabled={sending}
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                Example: john@example.com, jane@example.com
                            </p>
                        </div>

                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                                <span className="font-semibold">Note:</span> Invited staff members will receive an email with a link to set their password and access the platform.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                            disabled={sending}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleInvite}
                            disabled={sending || !emails.trim()}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {sending ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Sending...
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
