"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UserPlus, Mail, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

export default function AddWorkerPage() {
    const [formData, setFormData] = useState({
        firstName: "",
        lastName: "",
        email: "",
        supervisorId: "",
    });
    const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
    const [availableCourses, setAvailableCourses] = useState<any[]>([]);
    const [supervisors, setSupervisors] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [step, setStep] = useState(1);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadInitialData();
    }, []);


    const loadInitialData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            // Get organization
            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            // Get supervisors
            const { data: supervisorData } = await supabase
                .from("users")
                .select("id, full_name")
                .eq("organization_id", userData?.organization_id)
                .eq("role", "supervisor")
                .is("deactivated_at", null);

            setSupervisors(supervisorData || []);

            // Get published courses
            const { data: coursesData } = await supabase
                .from("courses")
                .select("id, title")
                .eq("organization_id", userData?.organization_id)
                .not("published_at", "is", null);

            setAvailableCourses(coursesData || []);
        } catch (err) {
            console.error("Error loading data:", err);
            // setError((err as Error).message); // Optional: add state for initial load error if needed
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1) {
            // Validate step 1
            if (!formData.firstName || !formData.lastName || !formData.email) {
                setError("Please fill in all required fields");
                return;
            }
            setError("");
            setStep(2);
            return;
        }

        // Step 2: Create worker via Server Action
        setLoading(true);
        setError("");

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { data: userData } = await supabase
                .from("users")
                .select("organization_id")
                .eq("id", user.id)
                .single();

            // Prepare FormData for Server Action
            const submitData = new FormData();
            submitData.append("email", formData.email);
            submitData.append("fullName", `${formData.firstName} ${formData.lastName}`);
            submitData.append("role", "General Staff"); // Dummy value for required field
            submitData.append("category", "General"); // Dummy value for required field
            submitData.append("supervisorId", formData.supervisorId);
            submitData.append("organizationId", userData?.organization_id || "");

            // Direct course IDs only
            const directCourseIds: string[] = Array.from(selectedCourses);
            submitData.append("directCourseIds", JSON.stringify(directCourseIds));

            // Call Server Action
            const { createWorker } = await import("@/app/actions/worker");
            const result = await createWorker({}, submitData);

            if (result.error) {
                setError(result.error);
                setLoading(false);
                return;
            }

            // Redirect to success or workers list
            router.push("/admin/workers?added=true");
        } catch (err) {
            console.error("Error creating worker:", err);
            setError((err as Error).message || "Failed to create worker");
            setLoading(false);
        }
    };

    const toggleCourse = (courseId: string) => {
        const newSelected = new Set(selectedCourses);
        if (newSelected.has(courseId)) {
            newSelected.delete(courseId);
        } else {
            newSelected.add(courseId);
        }
        setSelectedCourses(newSelected);
    };

    return (
        <div className="min-h-screen bg-white py-8 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Add New Worker</h1>
                    <p className="text-slate-600">
                        Add a staff member and assign their training courses
                    </p>
                </div>

                {/* Progress Steps */}
                <div className="mb-8 flex items-center justify-center gap-4">
                    <div className="flex items-center">
                        <div
                            className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${step >= 1 ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-500"
                                }`}
                        >
                            1
                        </div>
                        <span className="ml-2 text-sm font-medium text-slate-900">Worker Details</span>
                    </div>
                    <div className="w-16 h-0.5 bg-gray-300" />
                    <div className="flex items-center">
                        <div
                            className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${step >= 2 ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-500"
                                }`}
                        >
                            2
                        </div>
                        <span className="ml-2 text-sm font-medium text-slate-900">Assign Courses</span>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                    {step === 1 ? (
                        /* Step 1: Worker Information */
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="firstName" className="block text-sm font-medium text-slate-700 mb-1">
                                        First Name <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            id="firstName"
                                            type="text"
                                            value={formData.firstName}
                                            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                            required
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                            placeholder="John"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="lastName" className="block text-sm font-medium text-slate-700 mb-1">
                                        Last Name <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            id="lastName"
                                            type="text"
                                            value={formData.lastName}
                                            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                            required
                                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                            placeholder="Doe"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                                    Email <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        id="email"
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        required
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        placeholder="john@example.com"
                                    />
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    Worker will receive a welcome email with login instructions
                                </p>
                            </div>


                            {supervisors.length > 0 && (
                                <div>
                                    <label htmlFor="supervisor" className="block text-sm font-medium text-slate-700 mb-1">
                                        Supervisor (Optional)
                                    </label>
                                    <select
                                        id="supervisor"
                                        value={formData.supervisorId}
                                        onChange={(e) => setFormData({ ...formData, supervisorId: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                                    >
                                        <option value="">No supervisor assigned</option>
                                        {supervisors.map((sup) => (
                                            <option key={sup.id} value={sup.id}>
                                                {sup.full_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <button
                                type="submit"
                                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                            >
                                Continue to Course Assignment
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        /* Step 2: Course Assignment */
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 mb-2">Available Courses</h2>
                            <p className="text-sm text-slate-600 mb-6">
                                Select the courses to assign to this staff member.
                            </p>

                            {/* Available Courses */}
                            {availableCourses.length > 0 ? (
                                <div className="space-y-2">
                                    {availableCourses.map((course) => {
                                        const isSelected = selectedCourses.has(course.id);
                                        return (
                                            <div
                                                key={course.id}
                                                className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected
                                                    ? "border-indigo-500 bg-indigo-50"
                                                    : "border-gray-200 hover:border-gray-300"
                                                    }`}
                                                onClick={() => toggleCourse(course.id)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {isSelected ? (
                                                        <CheckCircle className="w-4 h-4 text-indigo-600" />
                                                    ) : (
                                                        <div className="w-4 h-4 border-2 border-gray-300 rounded" />
                                                    )}
                                                    <span className="text-sm text-slate-900">{course.title}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-600">
                                    No courses available.
                                </div>
                            )}

                            <div className="mt-8 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setStep(1)}
                                    className="px-6 py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                >
                                    {loading ? "Creating Worker..." : "Create Worker & Assign Courses"}
                                    <CheckCircle className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    )
                    }
                </form >
            </div >
        </div >
    );
}
