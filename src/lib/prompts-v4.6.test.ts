import { describe, it, expect } from 'vitest';
import { buildPromptA_v46 } from './prompts-v4.6';

describe('buildPromptA_v46', () => {
  it('should replace {{DOCUMENT_TEXT}} and {{METADATA_JSON}} when both are provided', () => {
    const documentText = 'This is the document text.';
    const metadataJson = '{"key":"value"}';
    const result = buildPromptA_v46(documentText, metadataJson);

    expect(result).toContain(documentText);
    expect(result).toContain(metadataJson);
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should default {{METADATA_JSON}} to "None" when metadataJson is undefined', () => {
    const documentText = 'This is the document text.';
    const result = buildPromptA_v46(documentText);

    expect(result).toContain(documentText);
    expect(result).toContain('OPTIONAL METADATA JSON:\nNone');
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should handle empty strings correctly', () => {
    const documentText = '';
    const metadataJson = '';
    const result = buildPromptA_v46(documentText, metadataJson);

    expect(result).toContain('DOCUMENT TEXT:\n\n');
    expect(result).toContain('OPTIONAL METADATA JSON:\nNone'); // Note: buildPromptA_v46 uses || 'None', so '' becomes 'None'
    expect(result).not.toContain('{{DOCUMENT_TEXT}}');
    expect(result).not.toContain('{{METADATA_JSON}}');
  });

  it('should handle input containing literal template strings {{DOCUMENT_TEXT}} and {{METADATA_JSON}}', () => {
    const documentText = 'Some text with {{DOCUMENT_TEXT}} and {{METADATA_JSON}} inside.';
    const metadataJson = '{"key": "{{DOCUMENT_TEXT}}"}';
    const result = buildPromptA_v46(documentText, metadataJson);

    // Using .replace() in JS replacing {{DOCUMENT_TEXT}} first might inject {{METADATA_JSON}},
    // which then gets caught by the next .replace('{{METADATA_JSON}}').
    // Let's assert the exact expected behaviour of the current implementation.
    // Replace 1: template.replace('{{DOCUMENT_TEXT}}', docText)
    //            -> '...DOCUMENT TEXT:\nSome text with {{DOCUMENT_TEXT}} and {{METADATA_JSON}} inside.\n\nOPTIONAL METADATA JSON:\n{{METADATA_JSON}}'
    // Replace 2: result1.replace('{{METADATA_JSON}}', metadataJson)
    //            -> Since JS replace only replaces the FIRST occurrence, it replaces the injected {{METADATA_JSON}}
    //               and leaves the original {{METADATA_JSON}} in the template untouched!

    expect(result).toContain('DOCUMENT TEXT:\nSome text with {{DOCUMENT_TEXT}} and {"key": "{{DOCUMENT_TEXT}}"} inside.');
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
    const documentText = 'Here are some `backticks`, "quotes", \'single quotes\', <angle brackets>, \\n \\t newlines and tabs.';
    const metadataJson = '{"html": "<div>`test`</div>"}';
    const result = buildPromptA_v46(documentText, metadataJson);

    expect(result).toContain(documentText);
    expect(result).toContain(metadataJson);
  });
});
