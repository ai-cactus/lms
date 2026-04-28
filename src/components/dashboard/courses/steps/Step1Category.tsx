'use client';

import React, { useState, useEffect } from 'react';
import { getCategories, createCustomCategory } from '@/app/actions/categories';
import Button from '@/components/ui/Button';
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

  return (
    <div className={styles.container}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Select a Course Category</h2>
        <p className={styles.subtitle}>
          Choose a system category to automatically pull standard manual policies, or create a
          custom one.
        </p>
      </div>

      <div className={styles.grid}>
        {categories.map((cat) => (
          <div
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={`${styles.card} ${selectedCategoryId === cat.id ? styles.cardSelected : ''}`}
          >
            <div className={styles.cardHeader}>
              <h3 className={styles.cardName}>{cat.name}</h3>
              {cat.isSystem ? (
                <span className={styles.badgeSystem}>System</span>
              ) : (
                <span className={styles.badgeCustom}>Custom</span>
              )}
            </div>
            {cat.description && <p className={styles.cardDescription}>{cat.description}</p>}
          </div>
        ))}
      </div>

      {!isCreating ? (
        <div className={styles.createPrompt}>
          <p className={styles.createPromptText}>Don&apos;t see what you need?</p>
          <Button variant="outline" size="sm" onClick={() => setIsCreating(true)}>
            + Create Custom Category
          </Button>
        </div>
      ) : (
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
