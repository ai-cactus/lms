"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DebugPage() {
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [logs, setLogs] = useState<string[]>([]);
    const [envInfo, setEnvInfo] = useState<any>({});

    const addLog = (msg: string) => setLogs((prev) => [...prev, `${new Date().toISOString().split("T")[1]} - ${msg}`]);

    useEffect(() => {
        const runChecks = async () => {
            try {
                // 1. Check Env Vars
                const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

                setEnvInfo({
                    url: url ? `${url.substring(0, 15)}...` : "MISSING",
                    keyPresent: !!key,
                });

                if (!url || !key) {
                    addLog("❌ Missing Environment Variables!");
                    throw new Error("Missing Env Vars");
                }
                addLog("✅ Environment Variables Detected");

                // 2. Create Client
                const supabase = createClient();
                addLog("✅ Supabase Client Created");

                // 3. Test Connection (Health Check)
                // We try to select from a public table or just get session
                addLog("🔄 Testing Database Connection...");
                const { count: orgCount, error: orgError } = await supabase.from("organizations").select("*", { count: "exact", head: true });

                if (orgError) {
                    addLog(`❌ Database Error: ${orgError.message} (Code: ${orgError.code})`);
                    console.error("DB Error:", orgError);
                } else {
                    addLog("✅ Database Connection Successful!");
                    addLog(`ℹ️ Organizations Count: ${orgCount}`);
                }

                // 3b. Check Public Users
                const { count: usersCount, error: usersError } = await supabase.from("users").select("*", { count: "exact", head: true });
                if (usersError) {
                    addLog(`❌ Users Table Error: ${usersError.message}`);
                } else {
                    addLog(`ℹ️ Public Users Count: ${usersCount}`);
                }

                // 4. Check Auth Session
                addLog("🔄 Checking Auth Session...");
                const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

                if (sessionError) {
                    addLog(`❌ Auth Error: ${sessionError.message}`);
                } else if (sessionData.session) {
                    addLog(`✅ Authenticated as: ${sessionData.session.user.email}`);
                    addLog(`ℹ️ User ID: ${sessionData.session.user.id}`);
                } else {
                    addLog("ℹ️ No Active Session (User is logged out)");
                }

                setStatus("success");
            } catch (err: any) {
                addLog(`❌ Critical Error: ${err.message}`);
                setStatus("error");
            }
        };

        runChecks();
    }, []);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-mono">
            <h1 className="text-2xl font-bold mb-6 text-green-400">System Diagnostics</h1>

            <div className="mb-8 p-4 bg-slate-800 rounded border border-slate-700">
                <h2 className="text-lg font-bold mb-2 text-blue-400">Environment Config</h2>
                <div className="grid grid-cols-2 gap-4 max-w-md">
                    <div className="text-slate-400">Supabase URL:</div>
                    <div className="text-white">{envInfo.url}</div>
                    <div className="text-slate-400">Anon Key:</div>
                    <div className="text-white">{envInfo.keyPresent ? "Present ✅" : "MISSING ❌"}</div>
                </div>
            </div>

            <div className="p-4 bg-black rounded border border-slate-700 h-96 overflow-y-auto">
                <h2 className="text-lg font-bold mb-2 text-yellow-400">Execution Log</h2>
                {logs.map((log, i) => (
                    <div key={i} className="mb-1 border-b border-slate-800 pb-1 last:border-0">
                        {log}
                    </div>
                ))}
            </div>
        </div>
    );
}
