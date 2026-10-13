/**
 * The switch for the /system console's PERMANENT deletes (users now,
 * organizations next). Off unless `SYSTEM_HARD_DELETE_ENABLED` is exactly the
 * string `'true'`, and read on every call so flipping it needs no rebuild.
 *
 * Enabled on staging only. `docker-compose.production.yml` pins it to `'false'`
 * in `environment:`, which overrides the production env_file, and a unit test
 * guards that pin.
 */
export const HARD_DELETE_DISABLED_REFUSAL =
  'Permanent deletion is not enabled in this environment.';

export function isHardDeleteEnabled(): boolean {
  return process.env.SYSTEM_HARD_DELETE_ENABLED === 'true';
}
