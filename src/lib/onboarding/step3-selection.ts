import { OTHER_OPTION_ID } from '@/lib/constants/onboarding-options';

/**
 * Step 3 stores canonical option ids, except for "Other" selections which are
 * stored as the free text the user typed. These helpers convert between the
 * form state (ids + a separate "other" text box) and that stored shape.
 */

export function resolveSelection(selectedIds: string[], otherText: string): string[] {
  return selectedIds.flatMap((id) => {
    if (id !== OTHER_OPTION_ID) return [id];
    const trimmed = otherText.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function resolveSingleSelection(selectedId: string, otherText: string): string {
  return selectedId === OTHER_OPTION_ID ? otherText.trim() : selectedId;
}

export interface HydratedSelection {
  selectedIds: string[];
  otherText: string;
}

export function hydrateSelection(
  persisted: string[] | undefined,
  knownIds: ReadonlySet<string>,
): HydratedSelection {
  const selectedIds: string[] = [];
  let otherText = '';

  for (const value of persisted ?? []) {
    if (knownIds.has(value)) {
      selectedIds.push(value);
      continue;
    }
    // Anything we don't recognise was typed into the "Other" box on a prior visit.
    if (value && !otherText) {
      otherText = value;
      selectedIds.push(OTHER_OPTION_ID);
    }
  }

  return { selectedIds, otherText };
}

export interface HydratedSingleSelection {
  selectedId: string;
  otherText: string;
}

export function hydrateSingleSelection(
  persisted: string | undefined,
  knownIds: ReadonlySet<string>,
): HydratedSingleSelection {
  if (!persisted) return { selectedId: '', otherText: '' };
  if (knownIds.has(persisted)) return { selectedId: persisted, otherText: '' };
  return { selectedId: OTHER_OPTION_ID, otherText: persisted };
}
