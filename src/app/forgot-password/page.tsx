"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Hexagon, EnvelopeSimple, ArrowLeft } from "@phosphor-icons/react"
import { requestPasswordReset } from "@/app/actions/auth"

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState(false)
    const router = useRouter()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError("")

        const result = await requestPasswordReset(email)

        if (result.success) {
            setSuccess(true)
        } else {
            setError(result.error || "Failed to send reset email")
        }

        setLoading(false)
    }

    if (success) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <Hexagon size={32} weight="fill" className="text-indigo-600" />
                        <span className="text-2xl font-bold text-slate-900">Theraptly</span>
                    </div>

                    {/* Success Card */}
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <EnvelopeSimple size={32} weight="fill" className="text-green-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h1>
                        <p className="text-slate-600 mb-6">
                            We&apos;ve sent a password reset link to <strong>{email}</strong>
                        </p>
                        <p className="text-sm text-slate-500 mb-6">
                            The link will expire in 1 hour. If you don't see the email, check your spam folder.
                        </p>
                        <button
                            onClick={() => router.push("/login")}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    <Hexagon size={32} weight="fill" className="text-indigo-600" />
                    <span className="text-2xl font-bold text-slate-900">Theraptly</span>
                </div>

                {/* Forgot Password Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    <button
                        onClick={() => router.push("/login")}
                        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6 transition-colors"
                    >
                        <ArrowLeft size={16} />
                        Back to login
                    </button>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Forgot password?</h1>
                    <p className="text-slate-600 mb-6">
                        No worries! Enter your email and we'll send you a reset link.
                    </p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                                Email address
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                placeholder="you@example.com"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? "Sending..." : "Send reset link"}
                        </button>
                    </form>
                </div>

                <p className="text-center text-sm text-slate-500 mt-6">
                    Need an account? Contact your administrator.
                </p>
            </div>
        </div>
    )
}
