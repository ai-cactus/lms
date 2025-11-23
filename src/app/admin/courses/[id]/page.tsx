"use client";

import { useState } from "react";
import {
    Clock,
    Award,
    CheckCircle,
    BookOpen,
    Calendar,
    BarChart,
    FileText,
    MessageSquare,
    Star
} from "lucide-react";

export default function CourseDetailsPage({ params }: { params: { id: string } }) {
    const [activeTab, setActiveTab] = useState("about");

    // Mock data based on the mockup
    const course = {
        title: "Health & Safety Practices",
        description: "Mandatory annual training aligned with CARF 1.H 4. a-b",
        author: "John Doe Organization Policy",
        status: "Active",
        duration: "10 min read",
        passMark: "80%",
        overview: `This course ensures all personnel understand and apply CARF-aligned safety principles in daily operations. It covers essential workplace safety measures, emergency response protocols, and staff responsibilities in maintaining a safe therapeutic environment.
        
Designed to meet CARF Standards 1.H.4.a-b, this training is a mandatory annual requirement for all staff`,
        learningOutcomes: [
            "Recognize workplace hazards and apply preventive strategies.",
            "Respond effectively to emergencies and safety incidents.",
            "Comply with CARF and organizational safety standards.",
            "Understand staff responsibilities for safety and reporting."
        ],
        content: [
            "Benefits of remote worksop",
            "Challenges for remote workshops",
            "What goes into a successful remote work...",
            "Best practices for a remote workshop",
            "Common remote workshop mistakes",
            "Tools needed for remote workshops"
        ],
        metadata: {
            skillLevel: "Beginner",
            duration: "30 mins",
            lastUpdated: "March 21, 2025"
        }
    };

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header Section */}
            <div className="bg-slate-900 text-white -mx-8 -mt-8 px-8 py-12 mb-8">
                <div className="max-w-5xl">
                    <div className="text-sm text-slate-400 mb-4">
                        Training Center / Create Course / <span className="text-white">Course details</span>
                    </div>

                    <h1 className="text-4xl font-bold mb-2">{course.title}</h1>
                    <p className="text-lg text-slate-300 mb-6">{course.description}</p>

                    <p className="text-sm text-slate-400 mb-8">By {course.author}</p>

                    <div className="flex items-center gap-6 mb-8 border-b border-slate-700 pb-8">
                        <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-400"></span>
                            {course.status}
                        </span>

                        <div className="flex items-center gap-2 text-slate-300">
                            <Clock className="w-5 h-5" />
                            <span>{course.duration}</span>
                        </div>

                        <div className="flex items-center gap-2 text-slate-300">
                            <Award className="w-5 h-5" />
                            <span>Pass mark: {course.passMark}</span>
                        </div>
                    </div>

                    <button className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors">
                        View Course
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-2">
                    {/* Tabs */}
                    <div className="flex border-b border-gray-200 mb-8">
                        <button
                            onClick={() => setActiveTab("about")}
                            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "about"
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            About
                        </button>
                        <button
                            onClick={() => setActiveTab("ratings")}
                            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "ratings"
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            Course Ratings
                        </button>
                        <button
                            onClick={() => setActiveTab("discussions")}
                            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "discussions"
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            Discussions
                        </button>
                    </div>

                    {/* Tab Content */}
                    {activeTab === "about" && (
                        <div className="space-y-8">
                            <section>
                                <h2 className="text-2xl font-bold text-slate-900 mb-4">Course Overview</h2>
                                <div className="text-slate-600 leading-relaxed whitespace-pre-line">
                                    {course.overview}
                                </div>
                            </section>

                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-4">What You'll Learn</h2>
                                <ul className="space-y-3">
                                    {course.learningOutcomes.map((outcome, index) => (
                                        <li key={index} className="flex items-start gap-3 text-slate-600">
                                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0"></span>
                                            {outcome}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Course Content</h3>
                        <div className="space-y-3">
                            {course.content.map((item, index) => (
                                <div key={index} className={`text-sm ${index === 1 ? 'text-blue-600 font-medium' : 'text-slate-600'}`}>
                                    {item}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <BarChart className="w-4 h-4" />
                                    <span className="text-sm">Skill Level</span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">{course.metadata.skillLevel}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-sm">Duration</span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">{course.metadata.duration}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Calendar className="w-4 h-4" />
                                    <span className="text-sm">Last Updated</span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">{course.metadata.lastUpdated}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Calendar className="w-4 h-4" />
                                    <span className="text-sm">Last Updated</span>
                                </div>
                                <span className="text-sm font-medium text-slate-900">{course.metadata.lastUpdated}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
