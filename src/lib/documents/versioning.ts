import crypto from 'crypto';

export async function calculateHash(buffer: Buffer): Promise<string> {
    const hashSum = crypto.createHash('sha256');
    hashSum.update(buffer);
    return hashSum.digest('hex');
}
