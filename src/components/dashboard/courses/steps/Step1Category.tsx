'use client';

import React, { useState, useEffect } from 'react';
import { getCategories, createCustomCategory } from '@/app/actions/categories';
import Button from '@/components/ui/Button';

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
    return <div className="p-8 text-center text-gray-500">Loading categories...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Select a Course Category</h2>
        <p className="text-gray-500 mt-2">
          Choose a system category to automatically pull standard manual policies, or create a
          custom one.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map((cat) => (
          <div
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={`cursor-pointer border rounded-xl p-5 transition-all ${
              selectedCategoryId === cat.id
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-sm bg-white'
            }`}
          >
            <div className="flex justify-between items-start">
              <h3 className="font-semibold text-gray-900">{cat.name}</h3>
              {cat.isSystem ? (
                <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                  System
                </span>
              ) : (
                <span className="text-xs font-medium px-2 py-1 bg-green-100 text-green-700 rounded-full">
                  Custom
                </span>
              )}
            </div>
            {cat.description && (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{cat.description}</p>
            )}
          </div>
        ))}
      </div>

      {!isCreating ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500 mb-3">Don&apos;t see what you need?</p>
          <Button variant="outline" size="sm" onClick={() => setIsCreating(true)}>
            + Create Custom Category
          </Button>
        </div>
      ) : (
        <div className="mt-8 border border-gray-200 rounded-xl p-6 bg-gray-50">
          <h3 className="font-semibold text-gray-900 mb-4">Create Custom Category</h3>
          <form onSubmit={handleCreateCustom} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category Name</label>
              <input
                type="text"
                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Specialized Tool Training"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (Optional)
              </label>
              <textarea
                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500"
                rows={2}
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Briefly describe this category"
              />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
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
