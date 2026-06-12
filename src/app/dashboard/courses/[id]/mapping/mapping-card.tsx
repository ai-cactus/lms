'use client';

import { useState } from 'react';
import { saveMapping } from '@/app/actions/mapping';
import { Button } from '@/components/ui/button';

interface MappingSuggestion {
  standardId: string;
  snippet: string;
  confidence: number;
}

export default function MappingCard({
  documentVersionId,
  suggestion,
}: {
  documentVersionId: string;
  suggestion: MappingSuggestion;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function handleSave() {
    setStatus('saving');
    await saveMapping(documentVersionId, suggestion.standardId, suggestion.snippet, 'Auto-mapped');
    setStatus('saved');
  }

  return (
    <div className="mb-4 rounded-md border border-border bg-white p-4">
      <strong>{suggestion.standardId}</strong>
      <p className="text-sm leading-relaxed text-text-secondary">{suggestion.snippet}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-success">
          Match: {Math.round(suggestion.confidence * 100)}%
        </span>
        <Button size="sm" onClick={handleSave} disabled={status !== 'idle'}>
          {status === 'saved' ? 'Saved' : 'Approve'}
        </Button>
      </div>
    </div>
  );
}
