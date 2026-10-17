import { parseStorageUri } from '@/lib/storage/types';

/**
 * Onboarding step 2 runs before the organization exists, so a founder's
 * compliance uploads are parked under this per-user storage prefix until
 * `completeOnboarding` links them to the new facility.
 */
export function onboardingStoragePrefix(userId: string): string {
  return `onboarding/${userId}/`;
}

/**
 * The single ownership rule for parked onboarding uploads: the key must sit
 * strictly inside the user's own prefix. The trailing slash in the prefix stops
 * `onboarding/{id}x/...` matching `{id}`, and dot segments are refused so a key
 * can never point outside the prefix once a backend or client normalizes it.
 */
export function isOwnOnboardingStorageKey(key: string, userId: string | null | undefined): boolean {
  if (!userId) return false;

  const prefix = onboardingStoragePrefix(userId);
  if (!key.startsWith(prefix) || key.length === prefix.length) return false;

  return key.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/**
 * URI form of {@link isOwnOnboardingStorageKey} for values that arrive from the
 * client. Anything that is not a parseable storage URI is simply not owned.
 *
 * The bucket segment is deliberately not compared: every provider signs, reads
 * and deletes against its own configured bucket and ignores the URI's, so the
 * key is the only part that selects an object.
 */
export function isOwnOnboardingDocumentUri(
  storageUri: unknown,
  userId: string | null | undefined,
): boolean {
  if (typeof storageUri !== 'string') return false;

  let key: string;
  try {
    ({ key } = parseStorageUri(storageUri));
  } catch {
    return false;
  }
  return isOwnOnboardingStorageKey(key, userId);
}
