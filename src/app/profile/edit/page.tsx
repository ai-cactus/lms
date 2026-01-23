"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function EditProfilePage() {
    const router = useRouter();
    const supabase = createClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        loadUserProfile();
    }, []);

    const loadUserProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            setUserId(user.id);
            setEmail(user.email || "");

            // Get user profile from users table
            const { data: userData } = await supabase
                .from("users")
                .select("full_name, phone_number, profile_photo_url")
                .eq("id", user.id)
                .single();

            if (userData) {
                const nameParts = (userData.full_name || "").split(" ");
                setFirstName(nameParts[0] || "");
                setLastName(nameParts.slice(1).join(" ") || "");
                setPhoneNumber(userData.phone_number || "");
                setProfilePhotoUrl(userData.profile_photo_url || null);
            }

            setLoading(false);
        } catch (error) {
            console.error("Error loading profile:", error);
            setLoading(false);
        }
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !userId) return;

        setUploadingPhoto(true);
        try {
            // Upload to Supabase storage
            const fileExt = file.name.split(".").pop();
            const fileName = `${userId}/profile.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from("profile-photos")
                .upload(fileName, file, { upsert: true });

            if (uploadError) {
                console.error("Upload error:", uploadError);
                alert("Failed to upload photo. Please try again.");
                return;
            }

            // Get public URL
            const { data: urlData } = supabase.storage
                .from("profile-photos")
                .getPublicUrl(fileName);

            const photoUrl = urlData.publicUrl;

            // Update user profile with new photo URL
            await supabase
                .from("users")
                .update({ profile_photo_url: photoUrl })
                .eq("id", userId);

            setProfilePhotoUrl(photoUrl + `?t=${Date.now()}`); // Add cache buster
        } catch (error) {
            console.error("Error uploading photo:", error);
            alert("Failed to upload photo. Please try again.");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleSave = async () => {
        if (!userId) return;

        setSaving(true);
        try {
            const fullName = `${firstName} ${lastName}`.trim();

            const { error } = await supabase
                .from("users")
                .update({
                    full_name: fullName,
                    phone_number: phoneNumber,
                })
                .eq("id", userId);

            if (error) {
                console.error("Error saving profile:", error);
                alert("Failed to save profile. Please try again.");
            } else {
                alert("Profile saved successfully!");
                router.push("/admin/dashboard");
            }
        } catch (error) {
            console.error("Error saving profile:", error);
            alert("Failed to save profile. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        router.push("/admin/dashboard");
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading profile...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            {/* Top Bar */}
            <header className="border-b border-gray-200 px-6 lg:px-24 py-6">
                <div className="flex items-center justify-between">
                    <Link href="/admin/dashboard">
                        <Image
                            src="/assets/onboarding/logo-blue.svg"
                            alt="Theraptly"
                            width={159}
                            height={55}
                        />
                    </Link>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-4xl mx-auto px-6 lg:px-8 py-12">
                {/* Back Link */}
                <Link
                    href="/admin/dashboard"
                    className="inline-flex items-center gap-2 text-slate-900 font-medium mb-8 hover:text-slate-700 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to dashboard
                </Link>

                {/* Page Title */}
                <h1 className="text-3xl font-bold text-slate-900 mb-8">Edit Profile</h1>

                {/* Profile Photo Section */}
                <div className="mb-12">
                    <div className="relative w-32 h-32 mx-auto md:mx-0">
                        <div className="w-32 h-32 rounded-full bg-[#DBE1FF] overflow-hidden flex items-center justify-center">
                            {profilePhotoUrl ? (
                                <Image
                                    src={profilePhotoUrl}
                                    alt="Profile"
                                    fill
                                    className="object-cover rounded-full"
                                />
                            ) : (
                                <svg width="80" height="80" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18.9988 22.3458C22.7606 22.3458 25.8101 19.2963 25.8101 15.5345C25.8101 11.7727 22.7606 8.72314 18.9988 8.72314C15.237 8.72314 12.1875 11.7727 12.1875 15.5345C12.1875 19.2963 15.237 22.3458 18.9988 22.3458Z" fill="#7D91F2" />
                                    <path d="M32.0952 32.8191C28.6925 36.0312 24.1044 37.9999 19.0563 37.9999C14.0081 37.9999 9.31968 35.9882 5.90625 32.7133C6.06279 32.3895 6.24741 32.0806 6.43263 31.7759C7.30914 30.3366 8.41509 29.0872 9.73373 28.0333C9.85562 27.9359 9.93329 27.7889 10.0851 27.7273C10.3533 27.6712 10.5493 27.4788 10.7572 27.33C11.5089 26.7899 12.3412 26.4045 13.1681 26.0054C13.2392 25.9749 13.3109 25.948 13.3826 25.92C14.7221 25.4073 16.0969 25.0201 17.5261 24.8821C18.3501 24.8027 19.1835 24.866 20.0117 24.8612C21.0853 24.9036 22.1399 25.0656 23.1694 25.3816C24.8172 25.8883 26.3426 26.6399 27.7407 27.6491C29.3963 28.8434 30.6929 30.3545 31.7188 32.1135C31.852 32.3423 31.9625 32.5879 32.0952 32.8191Z" fill="#7D91F2" />
                                </svg>
                            )}
                        </div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingPhoto}
                            className="absolute bottom-0 right-0 w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                            {uploadingPhoto ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <Camera className="w-5 h-5" />
                            )}
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoUpload}
                            className="hidden"
                        />
                    </div>
                </div>

                {/* Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            First Name
                        </label>
                        <input
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="Enter first name"
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Last Name
                        </label>
                        <input
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Enter last name"
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Email Address
                        </label>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-slate-500 cursor-not-allowed"
                        />
                        <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Phone Number
                        </label>
                        <input
                            type="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="Enter phone number"
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
                        />
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-4 justify-end">
                    <button
                        onClick={handleCancel}
                        className="px-8 py-3 bg-gray-100 text-slate-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-8 py-3 bg-brand-primary text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            "Save Changes"
                        )}
                    </button>
                </div>
            </main>
        </div>
    );
}
