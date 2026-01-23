"use client";

import { useMemo } from "react";

interface PasswordStrengthMeterProps {
    password: string;
}

export default function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
    const analysis = useMemo(() => {
        const checks = {
            length: password.length >= 8,
            lowercase: /[a-z]/.test(password),
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
        };

        const metCount = Object.values(checks).filter(Boolean).length;

        // Build missing hints
        const missing: string[] = [];
        if (!checks.length) missing.push("8+ chars");
        if (!checks.lowercase) missing.push("lowercase");
        if (!checks.uppercase) missing.push("uppercase");
        if (!checks.number) missing.push("number");
        if (!checks.special) missing.push("symbol");

        // Determine strength
        let strength: "weak" | "fair" | "good" | "strong" = "weak";
        let percentage = 0;

        if (metCount === 5) {
            strength = "strong";
            percentage = 100;
        } else if (metCount >= 4) {
            strength = "good";
            percentage = 75;
        } else if (metCount >= 3) {
            strength = "fair";
            percentage = 50;
        } else if (metCount >= 1) {
            strength = "weak";
            percentage = 25;
        }

        return { checks, metCount, missing, strength, percentage };
    }, [password]);

    const strengthConfig = {
        weak: { color: "bg-red-500", text: "text-red-600", label: "Weak" },
        fair: { color: "bg-orange-500", text: "text-orange-600", label: "Fair" },
        good: { color: "bg-yellow-500", text: "text-yellow-600", label: "Good" },
        strong: { color: "bg-green-500", text: "text-green-600", label: "Strong" },
    };

    const config = strengthConfig[analysis.strength];

    if (!password) return null;

    return (
        <div className="space-y-2">
            {/* Progress Bar */}
            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                    className={`h-full ${config.color} transition-all duration-300 ease-out`}
                    style={{ width: `${analysis.percentage}%` }}
                />
            </div>

            {/* Status Line */}
            <div className="flex items-center justify-between text-xs">
                <span className={`font-semibold ${config.text}`}>
                    {config.label}
                </span>
                {analysis.missing.length > 0 && (
                    <span className="text-text-tertiary">
                        Missing: {analysis.missing.join(", ")}
                    </span>
                )}
                {analysis.missing.length === 0 && (
                    <span className="text-green-600">✓ All requirements met</span>
                )}
            </div>
        </div>
    );
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
        /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)
    );
}
