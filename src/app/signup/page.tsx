"use client";

import { Hexagon } from "@phosphor-icons/react";

export default function SignupPage() {
    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                <div className="flex items-center justify-center gap-2 mb-8">
                    <Hexagon size={32} weight="fill" className="text-indigo-600" />
                    <span className="text-2xl font-bold text-slate-900">Theraptly</span>
                </div>

                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Invite Only</h1>
                    <p className="text-slate-600 mb-6">
                        Account creation is currently restricted to invitations only.
                        Please contact your organization administrator to receive an access link.
                    </p>

                    <a
                        href="/login"
                        className="inline-block w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                    >
                        Return to Sign In
                    </a>
                </div>
            </div>
        </div>
    );
}
