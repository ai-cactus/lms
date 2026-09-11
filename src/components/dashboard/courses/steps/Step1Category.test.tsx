/**
 * Tests for the "Category" wizard step. The design replaced the plain
 * `Select` with a shadcn Command + Popover combobox (typeahead filtering),
 * while keeping the accessible contract the e2e specs drive: the trigger
 * stays `role="combobox"` and every choice stays `role="option"`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCategories } = vi.hoisted(() => ({ mockGetCategories: vi.fn() }));

vi.mock('@/app/actions/categories', () => ({ getCategories: mockGetCategories }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Step1Category from './Step1Category';

// jsdom stubs the Command + Popover stack (cmdk / Radix Popover) depends on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

const CATEGORIES = [
  { id: 'cat-1', name: 'Cybersecurity and Technology', description: null, isSystem: true },
  { id: 'cat-2', name: 'Clinical Care', description: null, isSystem: true },
];

function renderStep(overrides: Partial<React.ComponentProps<typeof Step1Category>> = {}) {
  const onSelect = vi.fn();
  const onCustomCategoryNameChange = vi.fn();
  render(
    <Step1Category
      selectedCategoryId=""
      onSelect={onSelect}
      customCategoryName=""
      onCustomCategoryNameChange={onCustomCategoryNameChange}
      {...overrides}
    />,
  );
  return { onSelect, onCustomCategoryNameChange };
}

async function openCombobox(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('combobox');
  await user.click(trigger);
  return trigger;
}

beforeEach(() => {
  mockGetCategories.mockReset();
  mockGetCategories.mockResolvedValue(CATEGORIES);
});

describe('Step1Category', () => {
  it('opens on a combobox trigger and lists every category plus the custom option, all as role="option"', async () => {
    const user = userEvent.setup();
    renderStep();

    await openCombobox(user);

    for (const category of CATEGORIES) {
      expect(await screen.findByRole('option', { name: category.name })).toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: 'Others (Custom)' })).toBeInTheDocument();
  });

  it('filters the options as the admin types', async () => {
    const user = userEvent.setup();
    renderStep();

    await openCombobox(user);
    await screen.findByRole('option', { name: 'Clinical Care' });

    await user.type(screen.getByPlaceholderText('Search categories...'), 'Cyber');

    expect(
      screen.getByRole('option', { name: 'Cybersecurity and Technology' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Clinical Care' })).not.toBeInTheDocument();
  });

  it('selects a category and closes the list', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStep();

    await openCombobox(user);
    await user.click(await screen.findByRole('option', { name: 'Clinical Care' }));

    expect(onSelect).toHaveBeenCalledWith('cat-2');
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
  });

  it('shows the selected category name on the trigger', async () => {
    renderStep({ selectedCategoryId: 'cat-1' });

    expect(await screen.findByRole('combobox')).toHaveTextContent('Cybersecurity and Technology');
  });

  it('choosing "Others (Custom)" clears the selection and reveals the free-text field', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderStep({ selectedCategoryId: 'cat-1' });

    await openCombobox(user);
    await user.click(await screen.findByRole('option', { name: 'Others (Custom)' }));

    expect(onSelect).toHaveBeenCalledWith('');
    expect(screen.getByPlaceholderText('Enter a category name')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('reports typed text as the custom category name', async () => {
    const user = userEvent.setup();
    const { onCustomCategoryNameChange } = renderStep({ customCategoryName: 'Others' });

    await user.type(await screen.findByPlaceholderText('Enter a category name'), 'X');

    expect(onCustomCategoryNameChange).toHaveBeenCalledWith('OthersX');
  });

  it('returns to the category list from custom entry, clearing what was typed', async () => {
    const user = userEvent.setup();
    const { onCustomCategoryNameChange } = renderStep({ customCategoryName: 'A rare disease' });

    await user.click(await screen.findByRole('button', { name: 'Choose from the category list' }));

    expect(onCustomCategoryNameChange).toHaveBeenCalledWith('');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });
});
