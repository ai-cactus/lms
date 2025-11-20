import Link from "next/link";
import { Hexagon } from "@phosphor-icons/react/dist/ssr";

export default function AuthCodeError() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    <Hexagon size={32} weight="fill" className="text-indigo-600" />
                    <span className="text-2xl font-bold text-slate-900">Theraptly</span>
                </div>

                {/* Error Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Authentication Error</h1>
                    <p className="text-slate-600 mb-6">
                        There was an error verifying your email. The confirmation link may have expired or been used already.
                    </p>

                    <div className="space-y-3">
                        <Link
                            href="/signup"
                            className="block w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                        >
                            Try Signing Up Again
                        </Link>
                        <Link
                            href="/login"
                            className="block w-full py-3 border border-gray-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                        >
                            Back to Login
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
