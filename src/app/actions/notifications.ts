"use server";

import { createClient } from "@/lib/supabase/server";

interface NotificationData {
    workerId?: string;
    workerName?: string;
    courseId?: string;
    courseName?: string;
    assignmentId?: string;
    quizScore?: number;
}

export async function createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: NotificationData
) {
    const supabase = await createClient();

    const { error } = await supabase.from("notifications").insert({
        user_id: userId,
        type,
        title,
        message,
        data: data || {},
        read: false,
    });

    if (error) {
        console.error("Error creating notification:", error);
        throw error;
    }
}

export async function notifyAdminsAboutCourseEvent(
    type: "course_started" | "course_completed" | "course_passed" | "course_failed",
    workerId: string,
    workerName: string,
    courseId: string,
    courseName: string,
    quizScore?: number
) {
    const supabase = await createClient();

    // Get all admin users in the organization
    const { data: worker } = await supabase
        .from("users")
        .select("organization_id")
        .eq("id", workerId)
        .single();

    if (!worker) return;

    const { data: admins } = await supabase
        .from("users")
        .select("id")
        .eq("organization_id", worker.organization_id)
        .eq("role", "admin");

    if (!admins || admins.length === 0) return;

    // Create notification messages based on type
    const notificationConfig = {
        course_started: {
            title: "Worker Started Course",
            message: `${workerName} has started the course "${courseName}"`,
        },
        course_completed: {
            title: "Course Completed",
            message: `${workerName} completed "${courseName}" with a score of ${quizScore}%`,
        },
        course_passed: {
            title: "Worker Passed Course! 🎉",
            message: `${workerName} passed "${courseName}" with ${quizScore}%`,
        },
        course_failed: {
            title: "Worker Failed Course",
            message: `${workerName} failed "${courseName}" (${quizScore}%). Consider assigning a retake.`,
        },
    };

    const config = notificationConfig[type];

    // Create notification for each admin
    const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type,
        title: config.title,
        message: config.message,
        data: {
            workerId,
            workerName,
            courseId,
            courseName,
            quizScore,
        },
        read: false,
    }));

    await supabase.from("notifications").insert(notifications);
}

export async function getUnreadNotifications(userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .eq("read", false)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error fetching notifications:", error);
        return [];
    }

    return data || [];
}

export async function getAllNotifications(userId: string, limit = 50) {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        console.error("Error fetching notifications:", error);
        return [];
    }

    return data || [];
}

export async function markNotificationAsRead(notificationId: string) {
    const supabase = await createClient();

    const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId);

    if (error) {
        console.error("Error marking notification as read:", error);
        throw error;
    }
}

export async function markAllAsRead(userId: string) {
    const supabase = await createClient();

    const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", userId)
        .eq("read", false);

    if (error) {
        console.error("Error marking all as read:", error);
        throw error;
    }
}
