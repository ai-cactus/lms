'use client';

import React, { useState, useEffect } from 'react';
import { getCategories, createCustomCategory } from '@/app/actions/categories';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { logger } from '@/lib/logger';

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
        logger.error({ msg: 'Failed to load categories', err: err });
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
      logger.error({ msg: 'Failed to create custom category', err: err });
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-sm text-text-secondary">Loading categories...</div>
    );
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
    <div className="mx-auto max-w-[800px] px-4 py-8">
      <div className="mb-8 text-center">
        <h2 className="font-heading text-[28px] font-bold tracking-[-0.5px] text-foreground">
          What category best fits the course you&apos;re creating?
        </h2>
      </div>

      <div className="mx-auto mb-8 max-w-[480px]">
        <label className="mb-1.5 block text-[13px] font-medium text-text-secondary">
          Category <span className="text-primary">*</span>
        </label>
        <Select
          value={isCreating ? 'custom' : selectedCategoryId}
          onValueChange={handleSelectChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCreating && (
        <div className="mt-8 rounded-xl border-[1.5px] border-border bg-bg-secondary p-6">
          <h3 className="mb-5 text-base font-semibold text-foreground">Create Custom Category</h3>
          <form onSubmit={handleCreateCustom}>
            <div className="mb-4">
              <label className="mb-1.5 block text-[13px] font-medium text-text-secondary">
                Category Name
              </label>
              <input
                type="text"
                className="box-border w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_3px_rgba(76,110,245,0.1)]"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Specialized Tool Training"
                required
              />
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[13px] font-medium text-text-secondary">
                Description (Optional)
              </label>
              <textarea
                className="box-border min-h-[72px] w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_3px_rgba(76,110,245,0.1)]"
                rows={2}
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Briefly describe this category"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" size="sm" disabled={!customName.trim()}>
                Save Category
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
