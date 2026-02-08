'use client';

import React, { useState } from 'react';
import styles from './CoursesList.module.css';
import { Button, Input, Select } from '@/components/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CourseWithStats } from '@/app/actions/course';

interface CoursesListClientProps {
    courses: CourseWithStats[];
}

export default function CoursesListClient({ courses }: CoursesListClientProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Filter Logic
    const filteredCourses = courses.filter((course) =>
        course.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Pagination Logic
    const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentCourses = filteredCourses.slice(startIndex, startIndex + itemsPerPage);
    const totalEntries = filteredCourses.length;

    // Handle Page Change
    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div>
                    <div className={styles.breadcrumbs}>Trainings / Courses</div>
                    <h1 className={styles.title}>Courses</h1>
                </div>
                <Button className={styles.createButton} onClick={() => router.push('/dashboard/courses/create')}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Create Course
                </Button>
            </div>

            {/* Content Card */}
            <div className={styles.card}>
                {/* Search */}
                <div className={styles.searchContainer}>
                    <Input
                        placeholder="Search for courses..."
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
                {/* Table */}
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ width: '40%' }}>Course Name</th>
                            <th style={{ width: '25%' }}>Assigned Staff</th>
                            <th style={{ width: '20%' }}>Completion %</th>
                            <th style={{ width: '15%' }}>Date Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {currentCourses.length > 0 ? (
                            currentCourses.map((course) => (
                                <tr
                                    key={course.id}
                                    onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                                    style={{ cursor: 'pointer' }}
                                    className={styles.clickableRow}
                                >
                                    <td>
                                        <div className={styles.courseInfo}>
                                            <div className={styles.courseIcon}>
                                                <Image
                                                    src={course.thumbnail || '/images/icon-course-blue.svg'}
                                                    alt={course.title}
                                                    width={40}
                                                    height={40}
                                                />
                                            </div>
                                            <div>
                                                <span className={styles.courseName}>{course.title}</span>

                                            </div>
                                        </div>
                                    </td>
                                    <td>{course.enrollmentsCount}</td>
                                    <td>{course.completionRate}%</td>
                                    <td>
                                        {new Date(course.createdAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        })}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
                                    No courses found.
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
