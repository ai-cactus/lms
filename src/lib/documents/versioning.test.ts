import { describe, it, expect } from 'vitest';
import { calculateHash } from './versioning';

describe('calculateHash', () => {
  it('should calculate the correct SHA-256 hash for a known string', async () => {
    const input = Buffer.from('hello world');
    const hash = await calculateHash(input);
    // Known SHA-256 hash for "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should return a valid hash for an empty Buffer', async () => {
    const input = Buffer.from('');
    const hash = await calculateHash(input);
    // Known SHA-256 hash for an empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should be deterministic (same input produces identical output)', async () => {
    const input = Buffer.from('deterministic test data');
    const hash1 = await calculateHash(input);
    const hash2 = await calculateHash(input);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', async () => {
    const input1 = Buffer.from('data A');
    const input2 = Buffer.from('data B');
    const hash1 = await calculateHash(input1);
    const hash2 = await calculateHash(input2);
    expect(hash1).not.toBe(hash2);
  });

  it('should calculate hash for binary data correctly', async () => {
    // A buffer with arbitrary binary data
    const binaryData = Buffer.from([0x00, 0xff, 0x88, 0x44, 0x22, 0x11, 0x01, 0x80]);
    const hash1 = await calculateHash(binaryData);
    const hash2 = await calculateHash(Buffer.from([0x00, 0xff, 0x88, 0x44, 0x22, 0x11, 0x01, 0x80]));

    expect(hash1).toHaveLength(64); // SHA-256 hex digest is 64 characters long
    expect(hash1).toMatch(/^[a-f0-9]+$/); // Should be a valid hex string
    expect(hash1).toBe(hash2); // Determinism with binary data
  });
});
