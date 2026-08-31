'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { getCategories } from '@/app/actions/categories';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { wizardControlClass, wizardInputClass, wizardTitleClass } from './wizardFormClasses';
import { logger } from '@/lib/logger';

const CUSTOM_OPTION_VALUE = 'custom';

interface Category {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

interface Step1CategoryProps {
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
  customCategoryName: string;
  onCustomCategoryNameChange: (name: string) => void;
}

export default function Step1Category({
  selectedCategoryId,
  onSelect,
  customCategoryName,
  onCustomCategoryNameChange,
}: Step1CategoryProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // Custom entry is a mode, not a derived value: the field stays in free-text
  // mode after "Others (Custom)" is picked and before anything is typed.
  const [isCustom, setIsCustom] = useState(customCategoryName !== '');

  useEffect(() => {
    async function loadCategories() {
      try {
        const data = await getCategories();
        setCategories(data);
      } catch (err) {
        logger.error({ msg: '[course] Failed to load categories', err });
      } finally {
        setLoading(false);
      }
    }
    loadCategories();
  }, []);

  const handleSelectChange = (value: string) => {
    if (value === CUSTOM_OPTION_VALUE) {
      setIsCustom(true);
      onSelect('');
      return;
    }
    setIsCustom(false);
    onCustomCategoryNameChange('');
    onSelect(value);
  };

  const handleReopenList = () => {
    setIsCustom(false);
    onCustomCategoryNameChange('');
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-sm text-text-secondary">Loading categories...</div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <h2 className={wizardTitleClass}>What category best fits the course you&apos;re creating?</h2>

      <div className="flex flex-col gap-[11px] md:px-[120px]">
        <label
          htmlFor="course-category"
          className="flex items-center gap-1.5 text-base font-medium tracking-[0.36px] text-black md:text-[18px]"
        >
          Category <span className="text-[#4254e3]">*</span>
        </label>

        {isCustom ? (
          <div className="relative">
            <input
              id="course-category"
              type="text"
              autoFocus
              value={customCategoryName}
              onChange={(e) => onCustomCategoryNameChange(e.target.value)}
              placeholder="Enter a category name"
              className={`${wizardInputClass} border-primary pr-12`}
            />
            <button
              type="button"
              onClick={handleReopenList}
              aria-label="Choose from the category list"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0a0a0a] opacity-50 transition-opacity hover:opacity-100"
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Select value={selectedCategoryId} onValueChange={handleSelectChange}>
            <SelectTrigger id="course-category" className={wizardControlClass}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_OPTION_VALUE}>Others (Custom)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
