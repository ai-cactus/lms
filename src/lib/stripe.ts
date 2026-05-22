import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

/**
 * Returns a singleton instance of the Stripe client.
 * Strictly checks for the environment variable only when the client is requested,
 * preventing build-time crashes if the variable is missing.
 */
export function getStripeClient(): Stripe {
  if (stripeInstance) return stripeInstance;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    // During build time (static generation/analysis), this is often missing.
    // We only throw if we are actually trying to use Stripe in a live environment.
    if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PHASE) {
      throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
    }
    // Return a dummy instance or fail late if during build
    return new Stripe('dummy_key', {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    });
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: '2026-02-25.clover',
    typescript: true,
  });

  return stripeInstance;
}

// For backward compatibility with existing imports
const stripe =
  typeof process !== 'undefined' && process.env.STRIPE_SECRET_KEY ? getStripeClient() : null;
export default stripe!;
