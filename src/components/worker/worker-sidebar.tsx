"use client";

import {
    SquaresFour,
    BookOpen,
    Lifebuoy,
    X
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface WorkerSidebarProps {
    isMobileMenuOpen: boolean;
    onCloseMobileMenu: () => void;
}

export function WorkerSidebar({ isMobileMenuOpen, onCloseMobileMenu }: WorkerSidebarProps) {
    const pathname = usePathname();

    const isActive = (path: string) => pathname?.startsWith(path);

    return (
        <>
            {/* Mobile backdrop */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={onCloseMobileMenu}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                w-64 bg-white border-r border-gray-200 flex flex-col justify-between h-full fixed left-0 top-0 z-50
                transition-transform duration-300 ease-in-out
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                lg:translate-x-0
            `}>
                <div>
                    {/* Logo */}
                    <div className="p-6 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="text-blue-600">
                                <svg width="33" height="33" viewBox="0 0 33 33" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <g clipPath="url(#clip0_11899_3653)">
                                        <path fillRule="evenodd" clipRule="evenodd" d="M11.0669 0.406494C9.24613 0.406494 7.49998 1.11215 6.21251 2.36822L0 8.42917V11.2035C0 13.1635 0.862979 14.9269 2.23847 16.1517C0.862979 17.3766 0 19.14 0 21.1V23.8743L6.21251 29.9353C7.49998 31.1914 9.24613 31.897 11.0669 31.897C13.076 31.897 14.8834 31.0551 16.1389 29.7131C17.3943 31.0551 19.2018 31.897 21.2109 31.897C23.0317 31.897 24.7778 31.1914 26.0653 29.9353L32.2778 23.8743V21.1C32.2778 19.14 31.4148 17.3766 30.0393 16.1517C31.4148 14.9269 32.2778 13.1635 32.2778 11.2035V8.42917L26.0653 2.36822C24.7778 1.11215 23.0317 0.406494 21.2109 0.406494C19.2018 0.406494 17.3943 1.24842 16.1389 2.59037C14.8834 1.24842 13.076 0.406494 11.0669 0.406494ZM20.7859 16.1517C20.7085 16.0829 20.6326 16.0121 20.5582 15.9395L16.1389 11.628L11.7196 15.9395C11.6452 16.0121 11.5692 16.0829 11.4919 16.1517C11.5692 16.2206 11.6452 16.2914 11.7196 16.364L16.1389 20.6755L20.5582 16.364C20.6326 16.2914 20.7085 16.2206 20.7859 16.1517ZM17.9321 23.8743V25.1993C17.9321 26.9659 19.4001 28.3981 21.2109 28.3981C22.0804 28.3981 22.9144 28.0611 23.5293 27.4612L28.6914 22.425V21.1C28.6914 19.3334 27.2234 17.9012 25.4126 17.9012C24.5431 17.9012 23.7091 18.2382 23.0942 18.8381L17.9321 23.8743ZM14.3457 23.8743L9.18359 18.8381C8.5687 18.2382 7.73476 17.9012 6.86518 17.9012C5.05437 17.9012 3.58642 19.3334 3.58642 21.1V22.425L8.74849 27.4612C9.36338 28.0611 10.1974 28.3981 11.0669 28.3981C12.8777 28.3981 14.3457 26.9659 14.3457 25.1993V23.8743ZM14.3457 7.10423V8.42917L9.18359 13.4654C8.5687 14.0653 7.73476 14.4023 6.86518 14.4023C5.05437 14.4023 3.58642 12.9701 3.58642 11.2035V9.87852L8.74849 4.84234C9.36338 4.24245 10.1974 3.90544 11.0669 3.90544C12.8777 3.90544 14.3457 5.33758 14.3457 7.10423ZM23.0942 13.4654L17.9321 8.42917V7.10423C17.9321 5.33758 19.4001 3.90544 21.2109 3.90544C22.0804 3.90544 22.9144 4.24245 23.5293 4.84234L28.6914 9.87852V11.2035C28.6914 12.9701 27.2234 14.4023 25.4126 14.4023C24.5431 14.4023 23.7091 14.0653 23.0942 13.4654Z" fill="#0D25FF"/>
                                    </g>
                                    <defs>
                                        <clipPath id="clip0_11899_3653">
                                            <rect width="32.2778" height="32.2778" fill="white"/>
                                        </clipPath>
                                    </defs>
                                </svg>
                            </div>
                            <span className="text-xl font-bold tracking-tight text-blue-600">Theraptly</span>
                        </div>
                        {/* Mobile close button */}
                        <button
                            onClick={onCloseMobileMenu}
                            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            aria-label="Close menu"
                        >
                            <X className="w-5 h-5 text-slate-600" weight="bold" />
                        </button>
                    </div>

                    <nav className="mt-2 px-4 space-y-1">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3 mt-4">Learning</div>

                        <Link
                            href="/worker/dashboard"
                            className={`flex items-center px-3 h-14 text-base font-medium rounded-lg transition-colors ${isActive('/worker/dashboard')
                                ? 'text-black bg-[#EDEFF0]'
                                : 'text-slate-500 hover:bg-white hover:text-slate-900'
                                }`}
                            onClick={() => onCloseMobileMenu()}
                        >
                            <SquaresFour className="text-xl mr-3" weight={isActive('/worker/dashboard') ? "fill" : "regular"} />
                            Dashboard
                        </Link>

                        <Link
                            href="/worker/courses"
                            className={`flex items-center px-3 h-14 text-base font-medium rounded-lg transition-colors ${isActive('/worker/courses')
                                ? 'text-black bg-[#EDEFF0]'
                                : 'text-slate-500 hover:bg-white hover:text-slate-900'
                                }`}
                            onClick={() => onCloseMobileMenu()}
                        >
                            <BookOpen className="text-xl mr-3" weight={isActive('/worker/courses') ? "fill" : "regular"} />
                            Courses
                        </Link>
                    </nav>
                </div>

                <div className="p-4">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">Help & Settings</div>
                    <Link
                        href="/worker/help"
                        className={`flex items-center px-3 h-14 text-base font-medium rounded-lg transition-colors ${isActive('/worker/help')
                            ? 'text-black bg-[#EDEFF0]'
                            : 'text-slate-500 hover:bg-white hover:text-slate-900'
                            }`}
                        onClick={() => onCloseMobileMenu()}
                    >
                        <Lifebuoy className="text-xl mr-3" weight={isActive('/worker/help') ? "fill" : "regular"} />
                        Help Center
                    </Link>
                </div>
            </aside>
        </>
    );
}
