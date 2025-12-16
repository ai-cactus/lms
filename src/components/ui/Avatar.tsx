"use client";

import { useState } from "react";

interface AvatarProps {
    src?: string;
    alt?: string;
    fallback?: string;
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
}

const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
    xl: "w-16 h-16 text-lg"
};

export default function Avatar({ 
    src, 
    alt, 
    fallback, 
    size = "md", 
    className = "" 
}: AvatarProps) {
    const [imageError, setImageError] = useState(false);
    
    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map(n => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    const displayFallback = fallback ? getInitials(fallback) : "?";

    if (src && !imageError) {
        return (
            <img
                src={src}
                alt={alt || "Avatar"}
                onError={() => setImageError(true)}
                className={`${sizeClasses[size]} rounded-full object-cover ${className}`}
            />
        );
    }

    return (
        <div className={`${sizeClasses[size]} rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold ${className}`}>
            {displayFallback}
        </div>
    );
}
