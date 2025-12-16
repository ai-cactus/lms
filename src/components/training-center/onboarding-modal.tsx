"use client";

import { Lightbulb, X } from "@phosphor-icons/react";
import Link from "next/link";

interface OnboardingModalProps {
    onClose?: () => void;
    userRole?: 'admin' | 'worker';
}

export function OnboardingModal({ onClose, userRole = 'admin' }: OnboardingModalProps) {
    return (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden w-full relative">
            {/* Close button */}
            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label="Close"
                >
                    <X size={24} />
                </button>
            )}
            
            <div className="flex flex-col lg:flex-row">
                {/* Left Side - Illustration */}
                <div className="lg:w-1/2 bg-emerald-50 p-8 flex flex-col justify-center items-center relative overflow-hidden">
                    <div className="relative z-10 text-center">
                        <div className="mb-6 relative">
                            {/* Custom SVG Illustration */}
                            <div className="w-64 h-48 mx-auto relative">
                                <svg width="345" height="257" viewBox="0 0 345 257" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                                    <path d="M344.552 225.613H0V225.785H344.552V225.613Z" fill="#EBEBEB"/>
                                    <path d="M305.893 232.173H283.07V232.345H305.893V232.173Z" fill="#EBEBEB"/>
                                    <path d="M124.96 234.509H90.6016V234.682H124.96V234.509Z" fill="#EBEBEB"/>
                                    <path d="M282.38 238.576H262.031V238.748H282.38V238.576Z" fill="#EBEBEB"/>
                                    <path d="M51.0409 237.417H36.1562V237.589H51.0409V237.417Z" fill="#EBEBEB"/>
                                    <path d="M83.605 237.417H57.1641V237.589H83.605V237.417Z" fill="#EBEBEB"/>
                                    <path d="M228.243 230.306H163.688V230.478H228.243V230.306Z" fill="#EBEBEB"/>
                                    <path d="M163.323 194.879H30.2638C29.2215 194.877 28.2224 194.461 27.486 193.724C26.7495 192.986 26.3359 191.986 26.3359 190.944V3.90033C26.345 2.86393 26.7626 1.87297 27.4981 1.14269C28.2335 0.4124 29.2274 0.0017754 30.2638 0H163.323C164.367 0 165.367 0.414557 166.105 1.15247C166.843 1.89039 167.258 2.89121 167.258 3.93478V190.944C167.258 191.987 166.843 192.988 166.105 193.726C165.367 194.464 164.367 194.879 163.323 194.879ZM30.2638 0.137821C29.2671 0.139647 28.3119 0.536857 27.6078 1.24227C26.9037 1.94768 26.5082 2.90364 26.5082 3.90033V190.944C26.5082 191.941 26.9037 192.897 27.6078 193.602C28.3119 194.307 29.2671 194.705 30.2638 194.706H163.323C164.32 194.705 165.276 194.308 165.981 193.602C166.687 192.897 167.084 191.941 167.085 190.944V3.90033C167.084 2.90301 166.687 1.94706 165.981 1.24185C165.276 0.536633 164.32 0.139643 163.323 0.137821H30.2638Z" fill="#EBEBEB"/>
                                    <path d="M312.376 194.879H179.31C178.267 194.877 177.267 194.462 176.529 193.724C175.792 192.987 175.377 191.987 175.375 190.944V3.90033C175.386 2.86331 175.805 1.87235 176.542 1.14225C177.278 0.412159 178.273 0.00175604 179.31 0H312.376C313.411 0.00358644 314.403 0.415012 315.137 1.1451C315.871 1.87519 316.288 2.86512 316.297 3.90033V190.944C316.297 191.985 315.884 192.984 315.149 193.721C314.414 194.459 313.417 194.875 312.376 194.879ZM179.31 0.137821C178.312 0.139643 177.357 0.536633 176.651 1.24185C175.946 1.94706 175.549 2.90301 175.547 3.90033V190.944C175.549 191.941 175.946 192.897 176.651 193.602C177.357 194.308 178.312 194.705 179.31 194.706H312.376C313.373 194.705 314.329 194.308 315.034 193.602C315.739 192.897 316.136 191.941 316.138 190.944V3.90033C316.136 2.90301 315.739 1.94706 315.034 1.24185C314.329 0.536633 313.373 0.139643 312.376 0.137821H179.31Z" fill="#EBEBEB"/>
                                    <path d="M74.9127 110.016L261.805 110.016V18.7374L74.9127 18.7374V110.016Z" fill="#E6E6E6"/>
                                    <path d="M71.4047 110.016L260.164 110.016V18.7374L71.4047 18.7374V110.016Z" fill="#F0F0F0"/>
                                    <path d="M74.9127 116.521L261.805 116.521V110.015L74.9127 110.015V116.521Z" fill="#E6E6E6"/>
                                    <path d="M65.5765 116.521L254.336 116.521V110.015L65.5765 110.015V116.521Z" fill="#F0F0F0"/>
                                    <path d="M255.273 105.124V23.644L76.3131 23.644V105.124L255.273 105.124Z" fill="#FAFAFA"/>
                                    <path d="M125.535 105.124L117.693 23.644H104.117L111.959 105.124H125.535Z" fill="white"/>
                                    <path d="M230.034 105.124L222.185 23.644H208.609L216.458 105.124H230.034Z" fill="white"/>
                                    <path d="M253 77.5047C253.099 77.5029 253.194 77.4622 253.263 77.3913C253.333 77.3204 253.372 77.225 253.372 77.1257V26.8211C253.379 26.7675 253.375 26.713 253.359 26.6612C253.344 26.6094 253.317 26.5615 253.282 26.5208C253.246 26.4801 253.202 26.4474 253.153 26.4251C253.104 26.4027 253.05 26.3911 252.996 26.3911C252.942 26.3911 252.889 26.4027 252.839 26.4251C252.79 26.4474 252.746 26.4801 252.711 26.5208C252.675 26.5615 252.649 26.6094 252.633 26.6612C252.618 26.713 252.613 26.7675 252.621 26.8211V77.1257C252.621 77.1755 252.63 77.2248 252.649 77.2708C252.669 77.3167 252.696 77.3585 252.732 77.3937C252.767 77.4289 252.809 77.4568 252.855 77.4759C252.901 77.4949 252.95 77.5047 253 77.5047Z" fill="#F0F0F0"/>
                                    <path d="M109.047 105.124L101.199 23.644H95.9062L103.755 105.124H109.047Z" fill="white"/>
                                    <path d="M76.9375 105.124V23.644H76.3173V105.124H76.9375Z" fill="#E6E6E6"/>
                                    <path opacity="0.5" d="M70.2578 32.526H257.15L257.598 25.5454H70.7057L70.2578 32.526Z" fill="#838383"/>
                                    <path opacity="0.5" d="M70.2578 44.0002H257.15L257.598 37.0195H70.7057L70.2578 44.0002Z" fill="#838383"/>
                                    <path opacity="0.5" d="M70.2578 55.4728H257.15L257.598 48.4922H70.7057L70.2578 55.4728Z" fill="#838383"/>
                                    <path opacity="0.5" d="M70.2578 66.9464H257.15L257.598 59.9658H70.7057L70.2578 66.9464Z" fill="#838383"/>
                                    <path opacity="0.5" d="M70.2578 78.4201H257.15L257.598 71.4395H70.7057L70.2578 78.4201Z" fill="#838383"/>
                                    <path opacity="0.5" d="M70.2578 89.8942H257.15L257.598 82.9136H70.7057L70.2578 89.8942Z" fill="#838383"/>
                                    <path d="M182.369 225.613H194.125V147.027H182.369V225.613Z" fill="#E6E6E6"/>
                                    <path d="M185.454 225.613H182.367V214.911H188.7L185.454 225.613Z" fill="#F0F0F0"/>
                                    <path d="M290.783 225.613H302.539V147.027H290.783V225.613Z" fill="#E6E6E6"/>
                                    <path d="M182.358 219.045H293.469V147.027H182.358V219.045Z" fill="#F0F0F0"/>
                                    <path d="M184.755 169.961H291.07V150.211H184.755V169.961Z" fill="#E6E6E6"/>
                                    <path d="M203.285 156.35H270.473C273.491 156.35 276.372 153.918 278.446 149.611H195.312C197.387 153.918 200.267 156.35 203.285 156.35Z" fill="#F0F0F0"/>
                                    <path d="M290.379 225.613H293.473V214.911H287.141L290.379 225.613Z" fill="#F0F0F0"/>
                                    <path d="M184.755 192.908H291.07V173.158H184.755V192.908Z" fill="#E6E6E6"/>
                                    <path d="M203.285 179.299H270.473C273.491 179.299 276.372 176.859 278.446 172.559H195.312C197.387 176.859 200.267 179.299 203.285 179.299Z" fill="#F0F0F0"/>
                                    <path d="M184.755 215.855H291.07V196.105H184.755V215.855Z" fill="#E6E6E6"/>
                                    <path d="M203.285 202.238H270.473C273.491 202.238 276.372 199.799 278.446 195.499H195.312C197.387 199.799 200.267 202.238 203.285 202.238Z" fill="#F0F0F0"/>
                                    <path d="M104.954 122.777H91.3238C89.596 122.777 88.1953 124.178 88.1953 125.906V131.143C88.1953 132.871 89.596 134.272 91.3238 134.272H104.954C106.682 134.272 108.083 132.871 108.083 131.143V125.906C108.083 124.178 106.682 122.777 104.954 122.777Z" fill="#F5F5F5"/>
                                    <path d="M129.837 122.777H116.207C114.479 122.777 113.078 124.178 113.078 125.906V131.143C113.078 132.871 114.479 134.272 116.207 134.272H129.837C131.565 134.272 132.966 132.871 132.966 131.143V125.906C132.966 124.178 131.565 122.777 129.837 122.777Z" fill="#F5F5F5"/>
                                    <path d="M56.8359 120.477C56.8359 120.477 57.3114 134.259 75.49 134.259C93.6686 134.259 94.1371 120.477 94.1371 120.477H56.8359Z" fill="#F0F0F0"/>
                                    <path d="M135.02 221.121H155.031V138.614H135.02V221.121Z" fill="#F0F0F0"/>
                                    <path d="M52.5156 225.613H151.195V221.12H52.5156V225.613Z" fill="#F0F0F0"/>
                                    <path d="M135.016 138.606H48.6641V221.113H135.016V138.606Z" fill="#F5F5F5"/>
                                    <path d="M127.158 170.354H56.5391V189.373H127.158V170.354Z" fill="#F0F0F0"/>
                                    <path d="M127.158 193.618H56.5391V212.637H127.158V193.618Z" fill="#F0F0F0"/>
                                    <path d="M83.5528 172.903H100.126C100.547 172.901 100.951 172.733 101.249 172.435C101.547 172.137 101.716 171.733 101.718 171.311C101.718 170.888 101.55 170.483 101.252 170.183C100.953 169.883 100.549 169.714 100.126 169.712H83.5528C83.13 169.714 82.7251 169.883 82.4268 170.183C82.1284 170.483 81.9609 170.888 81.9609 171.311C81.9628 171.733 82.131 172.137 82.4292 172.435C82.7273 172.733 83.1311 172.901 83.5528 172.903Z" fill="#F5F5F5"/>
                                    <path d="M127.158 147.098H56.5391V166.117H127.158V147.098Z" fill="#F0F0F0"/>
                                    <path d="M83.5528 149.646H100.126C100.549 149.644 100.953 149.475 101.252 149.175C101.55 148.875 101.718 148.47 101.718 148.047C101.716 147.625 101.547 147.221 101.249 146.923C100.951 146.625 100.547 146.457 100.126 146.455H83.5528C83.1311 146.457 82.7273 146.625 82.4292 146.923C82.131 147.221 81.9628 147.625 81.9609 148.047C81.9609 148.47 82.1284 148.875 82.4268 149.175C82.7251 149.475 83.13 149.644 83.5528 149.646Z" fill="#F5F5F5"/>
                                    <path d="M83.554 196.161H100.127C101.006 196.161 101.719 195.448 101.719 194.569V194.562C101.719 193.683 101.006 192.971 100.127 192.971H83.554C82.6748 192.971 81.9621 193.683 81.9621 194.562V194.569C81.9621 195.448 82.6748 196.161 83.554 196.161Z" fill="#F5F5F5"/>
                                    <path d="M45.9972 138.606H135.016V134.265H45.9972V138.606Z" fill="#F0F0F0"/>
                                    <path d="M157.825 134.272H135.016V138.613H157.825V134.272Z" fill="#E6E6E6"/>
                                    <path d="M268.589 88.3367L263.648 80.853C263.821 124.17 264.551 126.665 264.53 134.121H268.493C269.044 97.8532 270.574 97.6396 268.589 88.3367Z" fill="#838383"/>
                                    <path d="M266.686 147.021C278.049 147.021 287.634 142.411 289.964 136.174C290.559 134.468 291.375 132.847 292.389 131.351L292.568 131.096H240.789L240.968 131.351C241.987 132.845 242.805 134.467 243.401 136.174C245.73 142.411 255.315 147.021 266.686 147.021Z" fill="#FAFAFA"/>
                                    <path d="M240.675 132.638H292.661C293.363 132.636 294.045 132.402 294.6 131.972C295.154 131.542 295.551 130.94 295.728 130.261C295.847 129.793 295.859 129.304 295.761 128.831C295.663 128.359 295.458 127.914 295.162 127.533C294.866 127.151 294.487 126.842 294.054 126.63C293.62 126.417 293.144 126.306 292.661 126.305H240.675C240.192 126.305 239.715 126.415 239.281 126.627C238.847 126.839 238.467 127.148 238.171 127.53C237.875 127.912 237.67 128.357 237.573 128.83C237.475 129.303 237.488 129.793 237.609 130.261C237.783 130.941 238.179 131.544 238.735 131.975C239.29 132.405 239.973 132.639 240.675 132.638Z" fill="#F0F0F0"/>
                                    <path d="M267.085 82.3067C266.1 70.592 254.047 69.4343 231.5 63.9146C242.56 95.7856 270.813 126.43 267.085 82.3067Z" fill="#838383"/>
                                    <path d="M263.828 76.1534C262.16 66.8505 263.904 56.9895 290.014 57.9542C283.474 83.5682 271.587 119.346 263.828 76.1534Z" fill="#838383"/>
                                    <path d="M265.007 98.8661C265.799 88.1506 274.055 75.4366 301.081 84.581C289.063 105.378 263.091 124.728 265.007 98.8661Z" fill="#838383"/>
                                    <path d="M172.274 256.733C246.065 256.733 305.885 253.241 305.885 248.932C305.885 244.624 246.065 241.132 172.274 241.132C98.4835 241.132 38.6641 244.624 38.6641 248.932C38.6641 253.241 98.4835 256.733 172.274 256.733Z" fill="#F5F5F5"/>
                                    <path d="M92.8541 152.458H177.414V147.896H92.8541V152.458Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M92.8541 152.458H177.414V147.896H92.8541V152.458Z" fill="white"/>
                                    <path d="M92.8536 147.895H54.1328V152.457H92.8536V147.895Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M92.8536 147.895H54.1328V152.457H92.8536V147.895Z" fill="white"/>
                                    <path opacity="0.2" d="M92.8536 147.895H54.1328V152.457H92.8536V147.895Z" fill="black"/>
                                    <path d="M56.7621 157.323H174.819L175.832 152.458H55.7422L56.7621 157.323Z" fill="#09C973"/>
                                    <path opacity="0.6" d="M56.7621 157.323H174.819L175.832 152.458H55.7422L56.7621 157.323Z" fill="black"/>
                                    <path d="M162.553 157.323V246.376H159.886L156.523 157.323H162.553Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M162.553 157.323V246.376H159.886L156.523 157.323H162.553Z" fill="white"/>
                                    <path d="M131.037 157.323V246.376H128.371L125.008 157.323H131.037Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M131.037 157.323V246.376H128.371L125.008 157.323H131.037Z" fill="white"/>
                                    <path d="M62.7031 157.323V246.376H65.37L68.7328 157.323H62.7031Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M62.7031 157.323V246.376H65.37L68.7328 157.323H62.7031Z" fill="white"/>
                                    <path d="M94.2188 157.323V246.376H96.8856L100.248 157.323H94.2188Z" fill="#09C973"/>
                                    <path opacity="0.5" d="M94.2188 157.323V246.376H96.8856L100.248 157.323H94.2188Z" fill="white"/>
                                </svg>
                            </div>
                        </div>

                        {userRole === 'admin' ? (
                            // Admin Content
                            <>
                                <h2 className="text-3xl font-bold text-emerald-800 mb-4">
                                    Turn Your Healthcare Policies into Interactive Training in Minutes.
                                </h2>
                                <p className="text-emerald-700/80 text-lg mb-8">
                                    Operationalize your policies and procedures by training your staff
                                </p>

                                <Link
                                    href="/admin/courses/create"
                                    className="inline-flex items-center justify-center px-8 py-4 text-base font-bold text-white transition-all duration-200 bg-emerald-600 border border-transparent rounded-full hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 shadow-lg shadow-emerald-600/20"
                                >
                                    Create your first course
                                </Link>
                            </>
                        ) : (
                            // Worker Content
                            <>
                                <h2 className="text-3xl font-bold text-emerald-800 mb-4">
                                    Your first training course awaits you
                                </h2>
                                <p className="text-emerald-700/80 text-lg mb-8">
                                    Join professionals on a mission to make THERAPTLY learning inspiring, accessible and fun for all learners.
                                </p>

                                <Link
                                    href="/worker/courses"
                                    className="inline-flex items-center justify-center px-8 py-4 text-base font-bold text-white transition-all duration-200 bg-emerald-600 border border-transparent rounded-full hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 shadow-lg shadow-emerald-600/20"
                                >
                                    Start your first course
                                </Link>
                            </>
                        )}
                    </div>

                    {/* Decorative elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
                        <div className="absolute top-10 left-10 w-20 h-20 bg-emerald-300 rounded-full blur-2xl"></div>
                        <div className="absolute bottom-10 right-10 w-32 h-32 bg-teal-300 rounded-full blur-3xl"></div>
                    </div>
                </div>

                {/* Right Side - Steps */}
                <div className="lg:w-1/2 p-8 lg:p-12 bg-white relative">
                    <div className="max-w-xl">
                        {userRole === 'admin' ? (
                            // Admin Content
                            <>
                                <h1 className="text-2xl font-bold text-slate-900 mb-8">How to get started</h1>

                                <div className="space-y-6">
                                    {/* Step 1 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">1. Select Type of Training</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Choose whether the training is based on compliance, safety, HR, or any internal policy area.
                                        </p>
                                    </div>

                                    {/* Step 2 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">2. Upload Policies</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Upload your organization's documents. Theraptly will analyze and prepare a draft training automatically.
                                        </p>
                                    </div>

                                    {/* Step 3 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">3. Configure Course & Assessment</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Define course structure, quiz settings, difficulty level, and deadlines.
                                        </p>
                                    </div>

                                    {/* Step 4 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">4. Review & Publish Course</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Review AI-generated lessons and quizzes, make adjustments, and approve for publishing. Instantly make your training available for your team to access and complete.
                                        </p>
                                    </div>

                                    {/* Step 5 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">5. Invite Workers to Course</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Assign courses to individuals or departments and track progress directly from your dashboard.
                                        </p>
                                    </div>
                                </div>
                            </>
                        ) : (
                            // Worker Content
                            <>
                                <h1 className="text-2xl font-bold text-slate-900 mb-8">How to get started</h1>

                                <div className="space-y-6">
                                    {/* Step 1 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">1. Log In to Your Dashboard</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Access your assigned courses in one place, right from your computer or phone.
                                        </p>
                                    </div>

                                    {/* Step 2 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">2. Complete your Courses and take quizzes.</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Training includes courses and quizzes. Access your assigned courses in one place, right from your computer or phone.
                                        </p>
                                    </div>

                                    {/* Step 3 */}
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">3. Earn Your Certificate</h3>
                                        <p className="text-slate-600 leading-relaxed">
                                            Pass your training and instantly get a certificate you can use to prove compliance.
                                        </p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
