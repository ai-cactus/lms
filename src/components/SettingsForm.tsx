'use client'

import { useState } from 'react'
import { updateOrgSettings, OrgSettings } from '@/app/actions/settings'
import { Save, Mail, Calendar, Clock, Plus, X } from 'lucide-react'

interface SettingsFormProps {
    organizationId: string
    initialSettings?: OrgSettings
}

export default function SettingsForm({ organizationId, initialSettings }: SettingsFormProps) {
    const [weeklyEnabled, setWeeklyEnabled] = useState(initialSettings?.weekly_report_enabled || false)
    const [monthlyEnabled, setMonthlyEnabled] = useState(initialSettings?.monthly_report_enabled || false)
    const [recipients, setRecipients] = useState<string[]>(initialSettings?.additional_recipients || [])
    const [newRecipient, setNewRecipient] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    const handleAddRecipient = () => {
        if (newRecipient && !recipients.includes(newRecipient)) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newRecipient)) {
                setMessage({ type: 'error', text: 'Invalid email address' })
                return
            }
            setRecipients([...recipients, newRecipient])
            setNewRecipient('')
            setMessage(null)
        }
    }

    const handleRemoveRecipient = (email: string) => {
        setRecipients(recipients.filter(r => r !== email))
    }

    const handleSave = async () => {
        setSaving(true)
        setMessage(null)

        try {
            const result = await updateOrgSettings(organizationId, {
                weekly_report_enabled: weeklyEnabled,
                monthly_report_enabled: monthlyEnabled,
                additional_recipients: recipients
            })

            if (result.success) {
                setMessage({ type: 'success', text: 'Settings saved successfully' })
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to save settings' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'An unexpected error occurred' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-8">
            {/* Notification */}
            {message && (
                <div className={`p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            {/* Report Toggles */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-indigo-600" />
                        Automated Reports
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Configure which reports you want to receive automatically via email.
                    </p>
                </div>

                <div className="p-6 space-y-6">
                    {/* Weekly Report */}
                    <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                            <div className="p-2 bg-blue-50 rounded-lg h-fit">
                                <Clock className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-medium text-gray-900">Weekly Compliance Snapshot</h3>
                                <p className="text-sm text-gray-500 mt-1 max-w-md">
                                    Receive a weekly summary every Monday morning with overdue trainings,
                                    pending confirmations, and overall compliance rates.
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={weeklyEnabled}
                                onChange={(e) => setWeeklyEnabled(e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>

                    <div className="border-t border-gray-100 my-4"></div>

                    {/* Monthly Report */}
                    <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                            <div className="p-2 bg-purple-50 rounded-lg h-fit">
                                <Calendar className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-medium text-gray-900">Monthly Performance Overview</h3>
                                <p className="text-sm text-gray-500 mt-1 max-w-md">
                                    Get a detailed performance report on the 1st of every month.
                                    Includes top struggling objectives, retraining stats, and course completion trends.
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={monthlyEnabled}
                                onChange={(e) => setMonthlyEnabled(e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Additional Recipients */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-indigo-600" />
                        Additional Recipients
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Add other team members who should receive these reports (e.g., supervisors, HR).
                    </p>
                </div>

                <div className="p-6">
                    <div className="flex gap-2 mb-4">
                        <input
                            type="email"
                            placeholder="Enter email address"
                            value={newRecipient}
                            onChange={(e) => setNewRecipient(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddRecipient()}
                            className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                        />
                        <button
                            onClick={handleAddRecipient}
                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Add
                        </button>
                    </div>

                    <div className="space-y-2">
                        {recipients.length === 0 ? (
                            <p className="text-sm text-gray-500 italic">No additional recipients added.</p>
                        ) : (
                            recipients.map((email) => (
                                <div key={email} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <span className="text-sm text-gray-700">{email}</span>
                                    <button
                                        onClick={() => handleRemoveRecipient(email)}
                                        className="text-gray-400 hover:text-red-600 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                >
                    {saving ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-5 h-5" />
                            Save Settings
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

function UsersIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
    )
}
