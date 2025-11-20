import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user role
  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (userData?.role === "admin") {
    redirect("/admin/dashboard");
  } else if (userData?.role === "worker") {
    redirect("/worker/dashboard");
  } else {
    // Fallback for unknown roles or errors
    redirect("/login");
  }
}
