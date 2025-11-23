"use client";

import { PencilSimple, FileText, BookOpen, WarningCircle, Lightbulb } from "@phosphor-icons/react";
import { CourseData } from "@/types/course";

interface Step5ReviewContentProps {
    data: CourseData;
    onNext: () => void;
    onBack: () => void;
}

export function Step5ReviewContent({ data, onNext, onBack }: Step5ReviewContentProps) {
    return (
        <div className="flex flex-col h-full">
            <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Review Course Content</h2>
                <p className="text-slate-500 max-w-2xl mx-auto">
                    Start by uploading the policy or compliance document you want to turn into a course. This will help you analyze and generate lessons and quizzes automatically.
                </p>
            </div>

            <div className="flex gap-8 flex-1 min-h-0">
                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto pr-4">
                    <div className="bg-white rounded-lg">
                        <div className="flex items-start justify-between mb-6">
                            <div>
                                <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded mb-2">
                                    CARF Policy
                                </span>
                                <h1 className="text-3xl font-bold text-slate-900 mb-4">
                                    {data.title || "10 Fundamental CARF Principles You Need to Know"}
                                </h1>
                                <p className="text-slate-600 mb-4">
                                    Master your skills in design workshop facilitation and learn how to promote collaboration and find the best design solutions. Learn what activities, tools, and deliverables can enhance your workshops.
                                </p>
                                <div className="flex items-center gap-4 text-sm text-slate-500">
                                    <div className="flex items-center gap-1">
                                        <FileText />
                                        <span>Last update: Jan 12, 2024</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <BookOpen />
                                        <span>10 min read</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="prose prose-slate max-w-none">
                            <h3>Benefits of CARF Principles</h3>
                            <p>
                                As remote work has become the new normal, teams are challenged to find new ways to collaborate and hold meetings. Remote workshops are your best bet if your team members are scattered worldwide or you're limited on time and budget.
                            </p>
                            <p>
                                On the flip side, during remote workshops, participants experience screen fatigue symptoms and get easily distracted. For a remote workshop to be successful and efficient, you must define the goals, prepare the agenda, decide on the participants' list, plan icebreakers, and schedule sufficient breaks.
                            </p>
                            <p>
                                One of the most important parts is finding the right tools that allow you to run a productive workshop and gather valuable insights.
                            </p>

                            <h3>How does CARF applies to Healthcare Sectors</h3>
                            <p>
                                Remote workshops are a great solution to gather all necessary people in one digital room regardless of geographical limits. However, there are also some potential pitfalls:
                            </p>
                            <ol>
                                <li>
                                    <strong>Poor choice of a digital tool and insufficient preparation:</strong> Avoid using tools unfamiliar to your team that might take more time to master. Instead, select the tools everyone on your team uses daily for communication or creating artifacts (for example, Notion for taking notes and Google Meet for communication and screen sharing). Take notes and don't solely rely on session recordings and transcripts, especially if there are a large number of participants.
                                </li>
                                <li>
                                    <strong>Bad planning for workshop activities:</strong> Cutting back on warmups, icebreakers, or team-building activities because you're short on time won't result in a productive session. Icebreakers help people relax and feel more confident to share honest thoughts. Team-building activities are vital if you involve people from different departments who aren't familiar with each other. If schedules clash, move workshop activities to asynchronous mode using email or corporate messaging platforms like Slack to gather feedback.
                                </li>
                                <li>
                                    <strong>Failure to define workshop goals and instructions:</strong> It's much harder for facilitators to have everyone's full attention and prevent participants from getting distracted during remote workshops. What might help is to clearly state the goals at the beginning of the session and define the expectations. Also, send clear instructions and the workshop agenda before the session, so participants have enough time to familiarize themselves and prepare for the meeting.
                                </li>
                            </ol>

                            <div className="bg-green-50 border border-green-100 rounded-lg p-4 flex gap-3 my-6">
                                <Lightbulb className="text-green-600 text-xl flex-shrink-0" weight="fill" />
                                <p className="text-green-800 text-sm m-0">
                                    Tip! Test the selected tool before the workshop to discover limitations in advance.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-between items-center mt-8 pt-8 border-t border-gray-200">
                            <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 text-sm font-medium">
                                <CaretLeft /> Previous Lesson
                            </button>
                            <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-slate-600 hover:bg-gray-50 text-sm font-medium">
                                Next Lesson <CaretRight />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                <div className="w-80 flex-shrink-0">
                    <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-slate-700 font-medium hover:bg-gray-50 mb-3 transition-colors">
                        <PencilSimple className="text-lg" />
                        Edit
                    </button>
                    <button className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 mb-8 transition-colors shadow-sm">
                        View as Slides
                    </button>

                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                        <h3 className="font-bold text-slate-900 mb-4">Table of Content</h3>
                        <div className="space-y-3 text-sm">
                            <a href="#" className="block text-blue-600 font-medium">Benefits of remote worksop</a>
                            <a href="#" className="block text-slate-600 hover:text-slate-900">Challenges for remote workshops</a>
                            <a href="#" className="block text-slate-600 hover:text-slate-900">What goes into a successful remote work...</a>
                            <a href="#" className="block text-slate-600 hover:text-slate-900">Best practices for a remote workshop</a>
                            <a href="#" className="block text-slate-600 hover:text-slate-900">Common remote workshop mistakes</a>
                            <a href="#" className="block text-slate-600 hover:text-slate-900">Tools needed for remote workshops</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CaretLeft() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function CaretRight() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
