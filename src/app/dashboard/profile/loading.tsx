import React from 'react';
import styles from './loading.module.css';

export default function Loading() {
    return (
        <div className={styles.container}>
            {/* Header Skeleton */}
            <div className={styles.headerSkeleton}>
                <div className={styles.backButtonSkeleton}></div>
            </div>

            {/* Content Skeleton */}
            <div className={styles.cardSkeleton}>
                {/* Tabs Skeleton */}
                <div className={styles.tabsSkeleton}></div>

                {/* Avatar Skeleton (New - for detail) */}
                <div className={styles.avatarSectionSkeleton}>
                    <div className={styles.avatarSkeleton}></div>
                    <div className={styles.editIconSkeleton}></div>
                </div>

                {/* Form Fields Skeletons */}
                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <div className={styles.labelSkeleton}></div>
                        <div className={styles.inputSkeleton}></div>
                    </div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.labelSkeleton}></div>
                        <div className={styles.inputSkeleton}></div>
                    </div>
                </div>

                <div className={styles.fieldGroup}>
                    <div className={styles.labelSkeleton}></div>
                    <div className={styles.inputSkeleton}></div>
                </div>

                <div className={styles.fieldGroup}>
                    <div className={styles.labelSkeleton}></div>
                    <div className={styles.inputSkeleton}></div>
                </div>

                <div className={styles.fieldGroup}>
                    <div className={styles.labelSkeleton}></div>
                    <div className={styles.inputSkeleton}></div>
                </div>

                {/* Buttons Skeleton */}
                <div className={styles.actionsSkeleton}>
                    <div className={styles.buttonSkeleton}></div>
                    <div className={styles.buttonSkeletonPrimary}></div>
                </div>
            </div>
        </div>
    );
}
