"use client";

import { useState, useRef, useEffect } from "react";
import { LogOut, User } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { useRouter } from "next/navigation";

interface UserProfileDropdownProps {
    userName: string;
    userInitials: string;
    onEditProfile?: () => void;
}

export function UserProfileDropdown({ userName, userInitials, onEditProfile }: UserProfileDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    const handleLogout = async () => {
        try {
            setIsLoggingOut(true);
            await signOut();
            router.push("/login");
        } catch (error) {
            console.error("Error signing out:", error);
            setIsLoggingOut(false);
        }
    };

    const handleEditProfile = () => {
        setIsOpen(false);
        if (onEditProfile) {
            onEditProfile();
        } else {
            // Default edit profile navigation (can be customized per role)
            router.push("/profile/edit");
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors"
            >
                <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                    {userInitials}
                </div>
                <div className="hidden md:flex flex-col items-start">
                    <p className="font-medium text-slate-700 text-sm">{userName}</p>
                </div>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                    <button
                        onClick={handleEditProfile}
                        className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors text-slate-700"
                    >
                        <User className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-medium">Edit Profile</span>
                    </button>
                    
                    <div className="border-t border-gray-100 my-1" />
                    
                    <button
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-red-50 transition-colors text-red-600 disabled:opacity-50"
                    >
                        <LogOut className="w-4 h-4" />
                        <span className="text-sm font-medium">
                            {isLoggingOut ? "Logging out..." : "Logout"}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
}
