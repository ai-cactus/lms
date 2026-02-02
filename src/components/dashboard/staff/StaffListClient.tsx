'use client';

import React, { useState } from 'react';
import styles from './StaffList.module.css';
import { Button, Input, Select } from '@/components/ui';
import { useRouter } from 'next/navigation';

interface User {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    role: string;
    jobTitle: string;
    dateInvited: Date;
}

interface StaffListClientProps {
    users: User[];
}

export default function StaffListClient({ users: initialUsers }: StaffListClientProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Filter Logic
    const filteredUsers = initialUsers.filter((user) =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Pagination Logic
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentUsers = filteredUsers.slice(startIndex, startIndex + itemsPerPage);
    const totalEntries = filteredUsers.length;

    // Handle Page Change
    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    // Calculate relative time (e.g. "2 days ago")
    const getRelativeTime = (date: Date) => {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - new Date(date).getTime()) / 1000);

        if (diffInSeconds < 60) return 'just now';

        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;

        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;

        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;

        const diffInMonths = Math.floor(diffInDays / 30);
        return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.titleSection}>
                    <h1 className={styles.title}>Staff Details</h1>
                    <p className={styles.subtitle}>Here is an overview of your staff details</p>
                </div>
                <button
                    className={styles.addButton}
                    onClick={() => console.log('Add New Staff Clicked')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add New Staff
                </button>
            </div>

            {/* Content Card */}
            <div className={styles.card}>
                {/* Search */}
                <div className={styles.searchContainer}>
                    <Input
                        placeholder="Search for staff..."
                        className={styles.searchInput}
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1); // Reset to page 1 on search
                        }}
                        leftIcon={
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        }
                    />
                </div>

                {/* Table */}
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ width: '40%' }}>Name</th>
                            <th style={{ width: '20%' }}>Date Invited</th>
                        </tr>
                    </thead>
                    <tbody>
                        {currentUsers.length > 0 ? (
                            currentUsers.map((user) => (
                                <tr
                                    key={user.id}
                                    onClick={() => router.push(`/dashboard/staff/${user.id}`)}
                                    style={{ cursor: 'pointer' }}
                                    className={styles.clickableRow}
                                >
                                    <td>
                                        <div className={styles.userInfo}>
                                            <div className={styles.avatar}>
                                                {user.avatarUrl ? (
                                                    <img
                                                        src={user.avatarUrl}
                                                        alt={user.name}
                                                        className={styles.avatarImage}
                                                    />
                                                ) : (
                                                    (user.name.charAt(0) || user.email.charAt(0)).toUpperCase()
                                                )}
                                                {/* Removed statusDot as it wasn't in the other design */}
                                            </div>
                                            <div className={styles.userDetails}>
                                                <div className={styles.userName}>{user.name}</div>
                                                <div className={styles.userRole}>{user.jobTitle}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{getRelativeTime(user.dateInvited)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={2} style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
                                    No staff found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* Pagination */}
                <div className={styles.pagination}>
                    <div className={styles.paginationInfo}>
                        Showing {totalEntries === 0 ? 0 : startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
                    </div>

                    <div className={styles.paginationCenter}>
                        <button
                            className={styles.pageButton}
                            disabled={currentPage === 1}
                            onClick={() => handlePageChange(currentPage - 1)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>

                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                                key={page}
                                className={`${styles.pageButton} ${page === currentPage ? styles.active : ''}`}
                                onClick={() => handlePageChange(page)}
                            >
                                {page}
                            </button>
                        ))}

                        <button
                            className={styles.pageButton}
                            disabled={currentPage === totalPages || totalPages === 0}
                            onClick={() => handlePageChange(currentPage + 1)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>

                    <div className={styles.paginationRight}>
                        Show
                        <Select
                            value={itemsPerPage.toString()}
                            onChange={(value) => {
                                setItemsPerPage(Number(value));
                                setCurrentPage(1);
                            }}
                            options={[
                                { label: '5', value: '5' },
                                { label: '10', value: '10' },
                                { label: '20', value: '20' }
                            ]}
                            size="sm"
                            direction="up"
                            className={styles.entriesSelect}
                        />
                        entries
                    </div>
                </div>
            </div>
        </div>
    );
}
