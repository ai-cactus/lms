"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLES, getSuggestedCourses, type WorkerRole, type CARFCourse } from "@/lib/carf-courses";
import { UserPlus, Mail, Briefcase, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

export default function AddWorkerPage() {
    const [formData, setFormData] = useState({
        fullName: "",
        email: "",
        role: "" as WorkerRole | "",
        supervisorId: "",
    });
    const [suggestedCourses, setSuggestedCourses] = useState<CARFCourse[]>([]);
    const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
    const [availableCourses, setAvailableCourses] = useState<any[]>([]);
    const [supervisors, setSupervisors] = useState<any[]>([]);
    const [programType, setProgramType] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [step, setStep] = useState(1);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (formData.role && programType) {
            const suggested = getSuggestedCourses(formData.role as WorkerRole, programType);
            setSuggestedCourses(suggested);

            // Auto-select required courses
            const requiredIds = new Set<string>(
                suggested.filter((c) => c.required).map((c) => c.id)
            );
            setSelectedCourses(requiredIds);
        }
    }, [formData.role, programType]);

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
                .select("organization_id, organization:organizations(*)")
                .eq("id", user.id)
                .single();

            if (userData?.organization && !Array.isArray(userData.organization)) {
                setProgramType((userData.organization as any).program_type || "Behavioral Health");
            }

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
        } catch (err: any) {
            console.error("Error loading data:", err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1) {
            // Validate step 1
            if (!formData.fullName || !formData.email || !formData.role) {
                setError("Please fill in all required fields");
                return;
            }
            setError("");
            setStep(2);
            return;
        }

        // Step 2: Create worker
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

            // Create auth user for worker
            const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                email: formData.email,
                email_confirm: true,
                user_metadata: {
                    full_name: formData.fullName,
                },
            });

            if (authError) throw authError;

            // Create user profile
            const { data: workerData, error: workerError } = await supabase
                .from("users")
                .insert({
                    id: authData.user.id,
                    organization_id: userData?.organization_id,
                    email: formData.email,
                    full_name: formData.fullName,
                    role: "worker",
                    supervisor_id: formData.supervisorId || null,
                })
                .select()
                .single();

            if (workerError) throw workerError;

            // Assign selected courses
            if (selectedCourses.size > 0) {
                const assignments = Array.from(selectedCourses).map((courseId) => ({
                    course_id: courseId,
                    worker_id: workerData.id,
                    assigned_by: user.id,
                    deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
                    status: "not_started",
                }));

                const { error: assignError } = await supabase
                    .from("course_assignments")
                    .insert(assignments);

                if (assignError) throw assignError;
            }

            // TODO: Send welcome email via Resend

            // Redirect to success or workers list
            router.push("/admin/workers?added=true");
        } catch (err: any) {
            setError(err.message || "Failed to create worker");
            setLoading(false);
        }
    };

    const toggleCourse = (courseId: string, required: boolean) => {
        if (required) return; // Can't deselect required courses

        const newSelected = new Set(selectedCourses);
        if (newSelected.has(courseId)) {
            newSelected.delete(courseId);
        } else {
            newSelected.add(courseId);
        }
        setSelectedCourses(newSelected);
    };

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
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
                        <span className="ml-2 text-sm font-medium text-slate-900">Worker Info</span>
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
                            <div>
                                <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        id="fullName"
                                        type="text"
                                        value={formData.fullName}
                                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        required
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        placeholder="John Doe"
                                    />
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

                            <div>
                                <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-1">
                                    Role <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <select
                                        id="role"
                                        value={formData.role}
                                        onChange={(e) => setFormData({ ...formData, role: e.target.value as WorkerRole })}
                                        required
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white appearance-none"
                                    >
                                        <option value="">Select a role...</option>
                                        {ROLES.map((role) => (
                                            <option key={role} value={role}>
                                                {role}
                                            </option>
                                        ))}
                                    </select>
                                </div>
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
                                Next: Assign Courses
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        /* Step 2: Course Assignment */
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 mb-2">Recommended Courses</h2>
                            <p className="text-sm text-slate-600 mb-6">
                                Based on the role <strong>{formData.role}</strong>, these CARF-mandated courses are recommended.
                                Required courses are pre-selected.
                            </p>

                            {suggestedCourses.length > 0 ? (
                                <div className="space-y-3 mb-6">
                                    {suggestedCourses.map((course) => {
                                        const isSelected = selectedCourses.has(course.id);
                                        const matchingCourse = availableCourses.find((c) =>
                                            c.title.toLowerCase().includes(course.title.toLowerCase())
                                        );

                                        return (
                                            <div
                                                key={course.id}
                                                className={`p-4 border-2 rounded-lg transition-colors cursor-pointer ${isSelected
                                                        ? "border-indigo-500 bg-indigo-50"
                                                        : "border-gray-200 hover:border-gray-300"
                                                    } ${course.required ? "opacity-100" : ""}`}
                                                onClick={() => toggleCourse(matchingCourse?.id || course.id, course.required)}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="flex-shrink-0 mt-1">
                                                        {isSelected ? (
                                                            <CheckCircle className="w-5 h-5 text-indigo-600" />
                                                        ) : (
                                                            <div className="w-5 h-5 border-2 border-gray-300 rounded" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <h3 className="font-semibold text-slate-900">{course.title}</h3>
                                                            {course.required && (
                                                                <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                                                                    Required
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-slate-600 mb-2">{course.description}</p>
                                                        <p className="text-xs text-slate-500">CARF Standard: {course.carfStandard}</p>
                                                        {!matchingCourse && (
                                                            <p className="text-xs text-yellow-600 mt-1">
                                                                ⚠️ Course not yet created - will need to be uploaded
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-600">
                                    No suggested courses for this role.
                                </div>
                            )}

                            {/* Additional Courses */}
                            {availableCourses.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="font-semibold text-slate-900 mb-3">Additional Available Courses</h3>
                                    <div className="space-y-2">
                                        {availableCourses
                                            .filter((c) => !suggestedCourses.some((sc) =>
                                                c.title.toLowerCase().includes(sc.title.toLowerCase())
                                            ))
                                            .map((course) => {
                                                const isSelected = selectedCourses.has(course.id);
                                                return (
                                                    <div
                                                        key={course.id}
                                                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${isSelected
                                                                ? "border-indigo-500 bg-indigo-50"
                                                                : "border-gray-200 hover:border-gray-300"
                                                            }`}
                                                        onClick={() => toggleCourse(course.id, false)}
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
                    )}
                </form>
            </div>
        </div>
    );
}
