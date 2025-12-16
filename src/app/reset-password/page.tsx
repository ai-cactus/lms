"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Hexagon, CheckCircle } from "@phosphor-icons/react"
import { updatePassword } from "@/app/actions/auth"
import PasswordStrengthMeter, { validatePassword } from "@/components/PasswordStrengthMeter"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState(false)
    const [isValidSession, setIsValidSession] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        // Check if user has a valid recovery session
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            setIsValidSession(!!session)

            if (!session) {
                setError("Invalid or expired reset link. Please request a new one.")
            }
        }

        checkSession()
    }, [supabase])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        // Validate passwords match
        if (password !== confirmPassword) {
            setError("Passwords do not match")
            return
        }

        // Validate password strength
        if (!validatePassword(password)) {
            setError("Password does not meet all requirements")
            return
        }

        setLoading(true)

        const result = await updatePassword(password)

        if (result.success) {
            setSuccess(true)
            // Redirect to login after 2 seconds
            setTimeout(() => {
                router.push("/login")
            }, 2000)
        } else {
            setError(result.error || "Failed to update password")
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
                            <CheckCircle size={32} weight="fill" className="text-green-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">Password updated!</h1>
                        <p className="text-slate-600 mb-6">
                            Your password has been successfully updated. Redirecting to login...
                        </p>
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

                {/* Reset Password Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Set new password</h1>
                    <p className="text-slate-600 mb-6">
                        Choose a strong password for your account.
                    </p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                                New password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={!isValidSession}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
                                placeholder="••••••••"
                            />
                        </div>

                        {password && (
                            <div className="p-4 bg-white rounded-lg">
                                <PasswordStrengthMeter password={password} />
                            </div>
                        )}

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">
                                Confirm new password
                            </label>
                            <input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                disabled={!isValidSession}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
                                placeholder="••••••••"
                            />
                            {confirmPassword && password !== confirmPassword && (
                                <p className="text-sm text-red-600 mt-1">Passwords do not match</p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !isValidSession || !validatePassword(password) || password !== confirmPassword}
                            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? "Updating..." : "Update password"}
                        </button>
                    </form>
                </div>

                <p className="text-center text-sm text-slate-500 mt-6">
                    Remember your password?{" "}
                    <a href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Sign in
                    </a>
                </p>
            </div>
        </div>
    )
}
