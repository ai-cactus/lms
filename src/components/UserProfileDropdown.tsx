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
                className="flex items-center gap-3 bg-[#F7F7F7] rounded-[64px] px-3 py-2 py-[9px] px-[10px] transition-colors"
            >
               <svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clipPath="url(#clip0_11899_13516)">
<path d="M19 38C29.4934 38 38 29.4934 38 19C38 8.50659 29.4934 0 19 0C8.50659 0 0 8.50659 0 19C0 29.4934 8.50659 38 19 38Z" fill="#DBE1FF"/>
<path d="M18.9988 22.3458C22.7606 22.3458 25.8101 19.2963 25.8101 15.5345C25.8101 11.7727 22.7606 8.72314 18.9988 8.72314C15.237 8.72314 12.1875 11.7727 12.1875 15.5345C12.1875 19.2963 15.237 22.3458 18.9988 22.3458Z" fill="#7D91F2"/>
<path d="M32.0952 32.8191C28.6925 36.0312 24.1044 37.9999 19.0563 37.9999C14.0081 37.9999 9.31968 35.9882 5.90625 32.7133C6.06279 32.3895 6.24741 32.0806 6.43263 31.7759C7.30914 30.3366 8.41509 29.0872 9.73373 28.0333C9.85562 27.9359 9.93329 27.7889 10.0851 27.7273C10.3533 27.6712 10.5493 27.4788 10.7572 27.33C11.5089 26.7899 12.3412 26.4045 13.1681 26.0054C13.2392 25.9749 13.3109 25.948 13.3826 25.92C14.7221 25.4073 16.0969 25.0201 17.5261 24.8821C18.3501 24.8027 19.1835 24.866 20.0117 24.8612C21.0853 24.9036 22.1399 25.0656 23.1694 25.3816C24.8172 25.8883 26.3426 26.6399 27.7407 27.6491C29.3963 28.8434 30.6929 30.3545 31.7188 32.1135C31.852 32.3423 31.9625 32.5879 32.0952 32.8191Z" fill="#7D91F2"/>
</g>
<defs>
<clipPath id="clip0_11899_13516">
<rect width="38" height="38" rx="19" fill="white"/>
</clipPath>
</defs>
</svg>

                <div className=" flex gap-2 items-end text-right">
                    <p className="font-medium text-slate-900 text-sm leading-tight">{userName}</p>
                    <svg className="my-auto" width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.75 0.75L6.75 6.75L12.75 0.75" stroke="#9EA2AE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
</svg>

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
