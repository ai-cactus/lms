'use client';

import React, { useState, useEffect } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { getCategories } from '@/app/actions/categories';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { wizardControlClass, wizardInputClass, wizardTitleClass } from './wizardFormClasses';
import { logger } from '@/lib/logger';

const CUSTOM_OPTION_VALUE = 'custom';
const CUSTOM_OPTION_LABEL = 'Others (Custom)';
const CATEGORY_LISTBOX_ID = 'course-category-listbox';

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
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(false);
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

  const selectedName = categories.find((category) => category.id === selectedCategoryId)?.name;

  return (
    <div className="flex w-full flex-col gap-10 md:gap-14">
      <h2 className={wizardTitleClass}>What category best fits the course you&apos;re creating?</h2>

      <div className="flex flex-col gap-[11px] md:px-[120px]">
        <label
          htmlFor="course-category"
          className="flex items-center gap-1.5 text-base font-medium tracking-[0.36px] text-foreground md:text-[18px]"
        >
          Category <span className="text-primary">*</span>
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
              className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary transition-colors hover:text-foreground"
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button
                id="course-category"
                type="button"
                role="combobox"
                aria-expanded={isOpen}
                aria-controls={CATEGORY_LISTBOX_ID}
                className={`${wizardControlClass} flex items-center justify-between gap-2 text-left ${
                  selectedName ? '' : 'text-muted-foreground'
                }`}
              >
                <span className="truncate">{selectedName ?? 'Select an option'}</span>
                <ChevronDown className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-(--radix-popover-trigger-width) rounded-md p-0"
            >
              <Command>
                <CommandInput placeholder="Search categories..." />
                <CommandList id={CATEGORY_LISTBOX_ID}>
                  <CommandEmpty>No matching category.</CommandEmpty>
                  <CommandGroup>
                    {categories.map((category) => (
                      <CategoryOption
                        key={category.id}
                        value={category.id}
                        label={category.name}
                        isSelected={category.id === selectedCategoryId}
                        onSelect={handleSelectChange}
                      />
                    ))}
                    <CategoryOption
                      value={CUSTOM_OPTION_VALUE}
                      label={CUSTOM_OPTION_LABEL}
                      isSelected={false}
                      onSelect={handleSelectChange}
                    />
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function CategoryOption({
  value,
  label,
  isSelected,
  onSelect,
}: {
  value: string;
  label: string;
  isSelected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandItem
      // cmdk matches on the item's text value, so the searchable term has to be
      // the label — the id it reports back comes from the closure instead.
      value={label}
      onSelect={() => onSelect(value)}
      className={`h-11 cursor-pointer justify-between px-3 text-base ${
        isSelected ? 'bg-primary/10 text-primary' : ''
      }`}
    >
      <span className="truncate">{label}</span>
      {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
    </CommandItem>
  );
}
