"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex">
          {/* Left side - Illustration */}
          <div className="flex-1 bg-gradient-to-br from-green-50 to-green-100 p-8 flex flex-col items-center justify-center min-h-[600px]">
            <div className="mb-8">
              <svg width="345" height="257" viewBox="0 0 345 257" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M344.552 225.613H0V225.785H344.552V225.613Z" fill="#EBEBEB"/>
                <path d="M305.893 232.173H283.07V232.345H305.893V232.173Z" fill="#EBEBEB"/>
                <path d="M124.96 234.509H90.6016V234.682H124.96V234.509Z" fill="#EBEBEB"/>
                <path d="M282.38 238.576H262.031V238.748H282.38V238.576Z" fill="#EBEBEB"/>
                <path d="M51.0409 237.417H36.1562V237.589H51.0409V237.417Z" fill="#EBEBEB"/>
                <path d="M83.605 237.417H57.1641V237.589H83.605V237.417Z" fill="#EBEBEB"/>
                <path d="M228.243 230.306H163.688V230.478H228.243V230.306Z" fill="#EBEBEB"/>
                {/* Rest of SVG paths... */}
              </svg>
            </div>
            
            <div className="text-center max-w-md">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                Turn Your Healthcare Policies into Interactive Training in Minutes.
              </h1>
              <p className="text-gray-600 mb-8">
                Operationalize your policies and procedures by training your staff
              </p>
              <button 
                onClick={onClose}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium transition-colors"
              >
                Create your first course
              </button>
            </div>
          </div>

          {/* Right side - Steps */}
          <div className="flex-1 p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-gray-900">How to get started</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-semibold">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Select Type of Training</h3>
                  <p className="text-gray-600">
                    Choose whether the training is based on compliance, safety, HR, or any internal policy area.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-semibold">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Upload Policies</h3>
                  <p className="text-gray-600">
                    Upload your organization&apos;s documents. Theraptly will analyze and prepare a draft training automatically.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-semibold">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Configure Course & Assessment</h3>
                  <p className="text-gray-600">
                    Define course structure, quiz settings, difficulty level, and deadlines.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-semibold">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Review & Publish Course</h3>
                  <p className="text-gray-600">
                    Review AI-generated lessons and quizzes, make adjustments, and approve for publishing. Instantly make your training available for your team to access and complete.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-semibold">
                  5
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Invite Workers to Course</h3>
                  <p className="text-gray-600">
                    Assign courses to individuals or departments and track progress directly from your dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
