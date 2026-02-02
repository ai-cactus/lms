'use client';

import React from 'react';
import styles from '../CourseWizard.module.css';
import { Select } from '@/components/ui';

interface Step1CategoryProps {
    value: string;
    onChange: (value: string) => void;
}

export default function Step1Category({ value, onChange }: Step1CategoryProps) {
    const options = [
        { label: 'Health and Safety Practices', value: 'health_and_safety_practices' },
        { label: 'Infection Prevention and Control', value: 'infection_prevention_and_control' },
        { label: 'Cybersecurity and Technology', value: 'cybersecurity_and_technology' },
        { label: 'Prevention of Unsafe Behaviors', value: 'prevention_of_unsafe_behaviors' },
        { label: 'Medication Management', value: 'medication_management' },
        { label: 'Nonviolent Practices', value: 'nonviolent_practices' },
        { label: 'Service Delivery via Information and Communication Technologies (Telehealth)', value: 'telehealth' },
        { label: 'First Aid, CPR, and Emergency Equipment Use', value: 'first_aid' },
        { label: 'Suicide Prevention', value: 'suicide_prevention' },
        { label: 'Orientation-Specific Trainings', value: 'orientation_specific_trainings' },
        { label: 'Crisis Programs/Contact Centers', value: 'crisis_programs' },
        { label: 'Detoxification/Withdrawal Management', value: 'detoxification' },
        { label: 'Office-Based Opioid Treatment', value: 'opioid_treatment' },
        { label: 'Court Treatment Programs', value: 'court_treatment' },
        { label: 'Health Home Programs', value: 'health_home_programs' },
    ];

    return (
        <div className={`${styles.stepWrapper} ${styles.centeredStep}`}>
            <h2 className={styles.stepTitle}>What category best fits the course you're creating?</h2>

            <div className={styles.inputContainer}>
                <Select
                    value={value}
                    onChange={onChange}
                    options={options}
                    placeholder="Select an option"
                    className={styles.selectInput}
                    dropdownClassName={styles.tallDropdown}
                />
            </div>
        </div>
    );
}
