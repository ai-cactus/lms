// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HARD_DELETE_DISABLED_REFUSAL, isHardDeleteEnabled } from './hard-delete-flag';

describe('isHardDeleteEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off when the variable is unset', () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', undefined);
    expect(isHardDeleteEnabled()).toBe(false);
  });

  it.each(['TRUE', 'True', '1', 'yes', ' true', 'true ', ''])('is off for %j', (value) => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', value);
    expect(isHardDeleteEnabled()).toBe(false);
  });

  it("is on only for the exact string 'true', read at call time", () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'true');
    expect(isHardDeleteEnabled()).toBe(true);
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'false');
    expect(isHardDeleteEnabled()).toBe(false);
  });

  it('exposes the refusal the console shows', () => {
    expect(HARD_DELETE_DISABLED_REFUSAL).toBe(
      'Permanent deletion is not enabled in this environment.',
    );
  });
});

// Production must never enable permanent deletion. Its compose file pins the
// flag off in `environment:`, which overrides anything in the env_file built
// from the production secret.
describe('production deploy files', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

  it("docker-compose.production.yml pins SYSTEM_HARD_DELETE_ENABLED to exactly 'false'", () => {
    const settings = read('docker-compose.production.yml')
      .split('\n')
      .filter(
        (line) => line.includes('SYSTEM_HARD_DELETE_ENABLED') && !line.trim().startsWith('#'),
      );
    expect(settings.map((line) => line.trim())).toEqual(["SYSTEM_HARD_DELETE_ENABLED: 'false'"]);
  });

  it('deploy-production.yml never sets SYSTEM_HARD_DELETE_ENABLED', () => {
    expect(read('.github/workflows/deploy-production.yml')).not.toContain(
      'SYSTEM_HARD_DELETE_ENABLED',
    );
  });
});
