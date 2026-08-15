'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** One file whose bytes are still on their way to the server. */
export interface PendingUpload {
  id: string;
  name: string;
  size: number;
  category: string;
}

interface UploadProgressValue {
  pendingUploads: PendingUpload[];
  startUploads: (files: File[], category: string) => void;
  clearUploads: () => void;
}

const UploadProgressContext = createContext<UploadProgressValue | null>(null);

/**
 * Bridges the two client islands under the (server) Documents page: the upload
 * modal publishes what it is currently uploading, and the list renders those
 * files as optimistic "In progress" rows until the server revalidation replaces
 * them with the real thing.
 */
export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  const startUploads = useCallback((files: File[], category: string) => {
    setPendingUploads(
      files.map((file) => ({
        id: `${file.name}:${file.size}`,
        name: file.name,
        size: file.size,
        category,
      })),
    );
  }, []);

  const clearUploads = useCallback(() => setPendingUploads([]), []);

  const value = useMemo(
    () => ({ pendingUploads, startUploads, clearUploads }),
    [pendingUploads, startUploads, clearUploads],
  );

  return <UploadProgressContext.Provider value={value}>{children}</UploadProgressContext.Provider>;
}

/**
 * The provider is optional so both islands stay independently renderable (and
 * unit-testable) outside the Documents page; without it, nothing is in flight.
 */
export function useUploadProgress(): UploadProgressValue {
  const context = useContext(UploadProgressContext);
  return context ?? EMPTY_PROGRESS;
}

const EMPTY_PROGRESS: UploadProgressValue = {
  pendingUploads: [],
  startUploads: () => {},
  clearUploads: () => {},
};
