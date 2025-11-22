"use client"

import { useMemo } from "react"
import { Check, X } from "@phosphor-icons/react"

interface PasswordStrengthMeterProps {
    password: string
}

interface PasswordRequirement {
    label: string
    met: boolean
}

export default function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
    const requirements = useMemo<PasswordRequirement[]>(() => {
        return [
            {
                label: "At least 8 characters",
                met: password.length >= 8
            },
            {
                label: "Contains uppercase letter",
                met: /[A-Z]/.test(password)
            },
            {
                label: "Contains lowercase letter",
                met: /[a-z]/.test(password)
            },
            {
                label: "Contains number",
                met: /[0-9]/.test(password)
            },
            {
                label: "Contains special character",
                met: /[^A-Za-z0-9]/.test(password)
            }
        ]
    }, [password])

    const metCount = requirements.filter(r => r.met).length
    const strength = metCount === 0 ? "none" : metCount <= 2 ? "weak" : metCount <= 4 ? "medium" : "strong"

    const strengthColors = {
        none: "bg-gray-200",
        weak: "bg-red-500",
        medium: "bg-yellow-500",
        strong: "bg-green-500"
    }

    const strengthLabels = {
        none: "",
        weak: "Weak",
        medium: "Medium",
        strong: "Strong"
    }

    return (
        <div className="space-y-3">
            {/* Strength Meter */}
            {password.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-600">Password Strength</span>
                        <span className={`text-xs font-semibold ${strength === "strong" ? "text-green-600" :
                                strength === "medium" ? "text-yellow-600" :
                                    strength === "weak" ? "text-red-600" : "text-gray-600"
                            }`}>
                            {strengthLabels[strength]}
                        </span>
                    </div>
                    <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                            <div
                                key={level}
                                className={`h-1.5 flex-1 rounded-full transition-colors ${level <= metCount ? strengthColors[strength] : "bg-gray-200"
                                    }`}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Requirements Checklist */}
            <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-600 mb-2">Password must contain:</p>
                {requirements.map((req, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                        {req.met ? (
                            <Check size={16} weight="bold" className="text-green-600 flex-shrink-0" />
                        ) : (
                            <X size={16} weight="bold" className="text-gray-400 flex-shrink-0" />
                        )}
                        <span className={req.met ? "text-green-700" : "text-slate-500"}>
                            {req.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

/**
 * Validate if password meets all requirements
 */
export function validatePassword(password: string): boolean {
    return (
        password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password)
    )
}
