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

/**
 * Backward-compatible default export.
 *
 * Previously this captured a possibly-null client at module-eval time
 * (`stripe!`), so any call site would throw a raw
 * `TypeError: Cannot read properties of null` when `STRIPE_SECRET_KEY` was
 * unset (e.g. `stripe.webhooks.constructEvent(...)`). It is now a lazy proxy
 * that resolves the real client via {@link getStripeClient} on first property
 * access, so a missing key surfaces getStripeClient()'s clear, intentional
 * error instead of an opaque null dereference.
 *
 * Prefer importing `{ getStripeClient }` directly in new code.
 */
const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripeClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default stripe;
