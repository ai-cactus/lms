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
import { wizardControlClass, wizardInputClass, wizardTitleClass } from './wizardFormClasses';
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
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <h2 className={wizardTitleClass}>What category best fits the course you&apos;re creating?</h2>

      <div className="flex flex-col gap-[11px] md:px-[120px]">
        <label className="flex items-center gap-1.5 text-base font-medium tracking-[0.36px] text-black md:text-[18px]">
          Category <span className="text-[#4254e3]">*</span>
        </label>
        <Select
          value={isCreating ? 'custom' : selectedCategoryId}
          onValueChange={handleSelectChange}
        >
          <SelectTrigger className={wizardControlClass}>
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
        <div className="rounded-[12px] border-[1.5px] border-[#e5e7ea] bg-bg-secondary p-6 md:mx-[120px]">
          <h3 className="mb-5 text-base font-semibold text-foreground md:text-[18px]">
            Create Custom Category
          </h3>
          <form onSubmit={handleCreateCustom}>
            <div className="mb-4 flex flex-col gap-[11px]">
              <label className="text-base font-medium tracking-[0.36px] text-black md:text-[18px]">
                Category Name
              </label>
              <input
                type="text"
                className={wizardInputClass}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Specialized Tool Training"
                required
              />
            </div>
            <div className="mb-4 flex flex-col gap-[11px]">
              <label className="text-base font-medium tracking-[0.36px] text-black md:text-[18px]">
                Description (Optional)
              </label>
              <textarea
                className={`${wizardInputClass} min-h-[96px] resize-y`}
                rows={2}
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Briefly describe this category"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" disabled={!customName.trim()}>
                Save Category
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
