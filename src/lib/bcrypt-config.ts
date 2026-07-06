/**
 * Standard bcrypt work factor for ALL password / credential hashing (F-058).
 *
 * Centralized here so every hash site — signup, password reset, force-reset,
 * invite acceptance, OAuth placeholder passwords, recovery codes, and the
 * dummy timing hash — uses one consistent cost. Raising this value upgrades
 * new hashes; existing lower-cost hashes are transparently re-hashed on the
 * user's next successful credentials login (see the `authorize()` callback in
 * src/lib/create-auth-instance.ts).
 *
 * 12 balances brute-force resistance against login latency on current hardware.
 */
export const BCRYPT_COST = 12;
