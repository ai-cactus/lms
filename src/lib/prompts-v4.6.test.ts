import { describe, it, expect } from 'vitest';
import { buildPromptA_v46 } from './prompts-v4.6';

describe('buildPromptA_v46', () => {
  it('should replace {{DOCUMENT_TEXT}} and {{METADATA_JSON}} when both are provided', () => {
    const documentText = 'This is the document text.';
    const ragContext = 'Some RAG context.';
    const metadataJson = '{"key":"value"}';
    const result = buildPromptA_v46(documentText, ragContext, metadataJson);

    expect(result).toContain(documentText);
    expect(result).toContain(ragContext);
    expect(result).toContain(metadataJson);
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{RAG_CONTEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should default {{METADATA_JSON}} and {{RAG_CONTEXT}} to defaults when undefined', () => {
    const documentText = 'This is the document text.';
    const result = buildPromptA_v46(documentText);

    expect(result).toContain(documentText);
    expect(result).toContain('STANDARD MANUAL CONTEXT (RAG):\nNone provided.');
    expect(result).toContain('OPTIONAL METADATA JSON:\nNone');
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{RAG_CONTEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should handle empty strings correctly', () => {
    const documentText = '';
    const ragContext = '';
    const metadataJson = '';
    const result = buildPromptA_v46(documentText, ragContext, metadataJson);

    expect(result).toContain('DOCUMENT TEXT:\n\n');
    expect(result).toContain('STANDARD MANUAL CONTEXT (RAG):\nNone provided.');
    expect(result).toContain('OPTIONAL METADATA JSON:\nNone');
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{RAG_CONTEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should handle input containing literal template strings {{DOCUMENT_TEXT}} and {{METADATA_JSON}}', () => {
    const documentText = 'Some text with {{DOCUMENT_TEXT}} and {{METADATA_JSON}} inside.';
    const ragContext = '{"key": "{{DOCUMENT_TEXT}}"}';
    const metadataJson = '{{METADATA_JSON}}';
    const result = buildPromptA_v46(documentText, ragContext, metadataJson);

    // Prompt A has 3 replacements: DOCUMENT_TEXT, RAG_CONTEXT, then METADATA_JSON.
    // Replace 1: DOCUMENT_TEXT -> result1
    //   '...DOCUMENT TEXT:\nSome text with {{DOCUMENT_TEXT}} and {{METADATA_JSON}} inside.\n\nSTANDARD MANUAL CONTEXT (RAG):\n{{RAG_CONTEXT}}...'
    // Replace 2: RAG_CONTEXT -> result2 (replaces only the first {{RAG_CONTEXT}} from template)
    //   '...RAG_CONTEXT):\n{"key": "{{DOCUMENT_TEXT}}"}\n\nOPTIONAL METADATA JSON:\n{{METADATA_JSON}}'
    // Replace 3: METADATA_JSON -> result3 (replaces the first {{METADATA_JSON}} it finds)
    //   Wait, if docText had {{METADATA_JSON}}, and result2 has it too, JS .replace() will hit the FIRST one.

    expect(result).toContain(
      'DOCUMENT TEXT:\nSome text with {{DOCUMENT_TEXT}} and {{METADATA_JSON}} inside.',
    );
    expect(result).toContain('STANDARD MANUAL CONTEXT (RAG):\n{"key": "{{DOCUMENT_TEXT}}"}');
    expect(result).toContain('OPTIONAL METADATA JSON:\n{{METADATA_JSON}}');
  });

  it('should handle very long input strings without truncation', () => {
    const documentText = 'A'.repeat(100000);
    const metadataJson = '{"key":"' + 'B'.repeat(50000) + '"}';
    const result = buildPromptA_v46(documentText, metadataJson);

    expect(result).toContain(documentText);
    expect(result).toContain(metadataJson);
  });

  it('should handle special characters like backticks, quotes, angle brackets correctly', () => {
    const documentText =
      'Here are some `backticks`, "quotes", \'single quotes\', <angle brackets>, \\n \\t newlines and tabs.';
    const metadataJson = '{"html": "<div>`test`</div>"}';
    const result = buildPromptA_v46(documentText, metadataJson);

    expect(result).toContain(documentText);
    expect(result).toContain(metadataJson);
  });
});
