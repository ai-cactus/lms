'use client';

import React, { useState, useEffect } from 'react';
import { getCategories, createCustomCategory } from '@/app/actions/categories';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import styles from './Step1Category.module.css';

interface Category {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

interface Step1CategoryProps {
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
}

export default function Step1Category({ selectedCategoryId, onSelect }: Step1CategoryProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');

  useEffect(() => {
    async function loadCategories() {
      try {
        const data = await getCategories();
        setCategories(data);
      } catch (err) {
        console.error('Failed to load categories', err);
      } finally {
        setLoading(false);
      }
    }
    loadCategories();
  }, []);

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;

    try {
      const newCat = await createCustomCategory(customName, customDesc);
      setCategories((prev) => [...prev, newCat]);
      onSelect(newCat.id);
      setIsCreating(false);
      setCustomName('');
      setCustomDesc('');
    } catch (err) {
      console.error('Failed to create custom category', err);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading categories...</div>;
  }

  const options = categories.map((cat) => ({
    label: cat.name,
    value: cat.id,
  }));
  options.push({ label: 'Others (Custom)', value: 'custom' });

  const handleSelectChange = (val: string) => {
    if (val === 'custom') {
      setIsCreating(true);
    } else {
      setIsCreating(false);
      onSelect(val);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.heading}>
        <h2 className={styles.title}>What category best fits the course you&apos;re creating?</h2>
      </div>

      <div className={styles.selectWrapper}>
        <label className={styles.fieldLabel}>
          Category <span className={styles.asterisk}>*</span>
        </label>
        <Select
          options={options}
          value={isCreating ? 'custom' : selectedCategoryId}
          onChange={handleSelectChange}
          placeholder="Select an option"
        />
      </div>

      {isCreating && (
        <div className={styles.createForm}>
          <h3 className={styles.createFormTitle}>Create Custom Category</h3>
          <form onSubmit={handleCreateCustom}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Category Name</label>
              <input
                type="text"
                className={styles.fieldInput}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Specialized Tool Training"
                required
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Description (Optional)</label>
              <textarea
                className={styles.fieldTextarea}
                rows={2}
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Briefly describe this category"
              />
            </div>
            <div className={styles.formActions}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={!customName.trim()}>
                Save Category
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
