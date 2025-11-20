"use client";

import {
    Hexagon,
    SquaresFour,
    Files,
    GraduationCap,
    CaretDown,
    Question
} from "@phosphor-icons/react";

export function Sidebar() {
    return (
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between h-full fixed left-0 top-0 z-10">
            <div>
                <div className="p-6 flex items-center gap-2 text-indigo-600">
                    <Hexagon weight="fill" className="text-3xl" />
                    <span className="text-xl font-bold tracking-tight text-slate-900">Theraptly</span>
                </div>

                <nav className="mt-6 px-2 space-y-1">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 mb-2">Main</div>
                    <a href="#" className="flex items-center px-4 py-3 text-sm font-medium rounded-md transition-colors bg-indigo-50 text-indigo-600 border-r-4 border-indigo-600">
                        <SquaresFour className="text-lg mr-3" />
                        Dashboard
                    </a>
                    <a href="#" className="flex items-center px-4 py-3 text-slate-600 text-sm font-medium rounded-md transition-colors hover:bg-slate-50">
                        <Files className="text-lg mr-3" />
                        Documents
                    </a>

                    <div className="mt-6 text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 mb-2">Training</div>
                    <a href="#" className="flex items-center px-4 py-3 text-slate-600 text-sm font-medium rounded-md transition-colors hover:bg-slate-50">
                        <GraduationCap className="text-lg mr-3" />
                        Training Center
                        <CaretDown className="ml-auto" />
                    </a>
                    <a href="#" className="flex items-center px-4 py-3 text-slate-600 text-sm font-medium rounded-md transition-colors pl-11 hover:bg-slate-50">
                        Courses
                    </a>
                    <a href="#" className="flex items-center px-4 py-3 text-slate-600 text-sm font-medium rounded-md transition-colors pl-11 hover:bg-slate-50">
                        Staff Details
                    </a>
                </nav>
            </div>

            <div className="p-4">
                <a href="#" className="flex items-center px-4 py-3 text-slate-600 text-sm font-medium rounded-md transition-colors hover:bg-slate-50">
                    <Question className="text-lg mr-3" />
                    Help Center
                </a>
            </div>
        </aside>
    );
}
