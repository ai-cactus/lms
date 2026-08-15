/**
 * Unit tests for the notification engine's routing table (Product Notes
 * §2.1/§2.2):
 *   - STAFF_ADDED: HR actor → owner only, no fallback; any other/no actor → HR,
 *     falling back to the owner.
 *   - DOCUMENT_UPLOADED: always clinical_director, falling back to the owner.
 *   - ROLE_FALLBACK_TRIGGERED: instant, owner only, NEVER falls back (would
 *     recurse into itself).
 *   - COMPLIANCE_LICENSE_EXPIRING: reserved instant entry, no emitter yet.
 *   - Every engine type has a matching display-catalog entry (NOTIFICATION_TYPES),
 *     since the digest/bell UI looks up labels by type key.
 */
import { describe, it, expect } from 'vitest';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORY,
  ENGINE_EVENTS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DEFAULTS,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_TYPES,
  categoryForNotificationType,
  notificationTypesFor,
  type NotificationEngineType,
} from './catalog';
import type { Role } from '@/types/next-auth';

const ENGINE_TYPES: NotificationEngineType[] = [
  'STAFF_ADDED',
  'DOCUMENT_UPLOADED',
  'ROLE_FALLBACK_TRIGGERED',
  'COMPLIANCE_LICENSE_EXPIRING',
];

describe('ENGINE_EVENTS — STAFF_ADDED routing', () => {
  it('routes to the owner only, with no fallback, when the actor is HR', () => {
    const targets = ENGINE_EVENTS.STAFF_ADDED.resolveTargets('hr');
    expect(targets).toEqual({ roles: ['owner'], fallbackToOwner: false });
  });

  it('routes to HR (with owner fallback) when the actor is a non-HR admin (e.g. supervisor)', () => {
    const targets = ENGINE_EVENTS.STAFF_ADDED.resolveTargets('supervisor');
    expect(targets).toEqual({ roles: ['hr'], fallbackToOwner: true });
  });

  it('routes to HR (with owner fallback) when there is no actor (self-serve join)', () => {
    expect(ENGINE_EVENTS.STAFF_ADDED.resolveTargets(null)).toEqual({
      roles: ['hr'],
      fallbackToOwner: true,
    });
    expect(ENGINE_EVENTS.STAFF_ADDED.resolveTargets(undefined)).toEqual({
      roles: ['hr'],
      fallbackToOwner: true,
    });
  });

  it('routes to HR (with owner fallback) for every non-HR role, including the owner and workers', () => {
    const nonHrRoles: Role[] = ['owner', 'supervisor', 'clinical_director', 'finance', 'nurse'];
    for (const role of nonHrRoles) {
      expect(ENGINE_EVENTS.STAFF_ADDED.resolveTargets(role)).toEqual({
        roles: ['hr'],
        fallbackToOwner: true,
      });
    }
  });

  it('tier is digest — batched, not instant', () => {
    expect(ENGINE_EVENTS.STAFF_ADDED.tier).toBe('digest');
  });
});

describe('ENGINE_EVENTS — DOCUMENT_UPLOADED routing', () => {
  it('always routes to clinical_director with owner fallback, regardless of actor role', () => {
    const actors: (Role | null | undefined)[] = ['clinical_director', 'owner', 'nurse', null];
    for (const actor of actors) {
      expect(ENGINE_EVENTS.DOCUMENT_UPLOADED.resolveTargets(actor)).toEqual({
        roles: ['clinical_director'],
        fallbackToOwner: true,
      });
    }
  });

  it('tier is digest', () => {
    expect(ENGINE_EVENTS.DOCUMENT_UPLOADED.tier).toBe('digest');
  });
});

describe('ENGINE_EVENTS — ROLE_FALLBACK_TRIGGERED routing', () => {
  it('routes to the owner with fallbackToOwner: false — it must never recurse', () => {
    expect(ENGINE_EVENTS.ROLE_FALLBACK_TRIGGERED.resolveTargets(null)).toEqual({
      roles: ['owner'],
      fallbackToOwner: false,
    });
    expect(ENGINE_EVENTS.ROLE_FALLBACK_TRIGGERED.resolveTargets('hr')).toEqual({
      roles: ['owner'],
      fallbackToOwner: false,
    });
  });

  it('tier is instant', () => {
    expect(ENGINE_EVENTS.ROLE_FALLBACK_TRIGGERED.tier).toBe('instant');
  });
});

describe('ENGINE_EVENTS — COMPLIANCE_LICENSE_EXPIRING (reserved)', () => {
  it('is a settled instant entry with no owner fallback', () => {
    const targets = ENGINE_EVENTS.COMPLIANCE_LICENSE_EXPIRING.resolveTargets(null);
    expect(ENGINE_EVENTS.COMPLIANCE_LICENSE_EXPIRING.tier).toBe('instant');
    expect(targets.fallbackToOwner).toBe(false);
    expect(targets.roles.length).toBeGreaterThan(0);
  });
});

describe('ENGINE_EVENTS — display catalog parity', () => {
  it('every engine type has a matching NOTIFICATION_TYPES entry (digest/bell labels)', () => {
    const displayKeys = new Set(NOTIFICATION_TYPES.map((t) => t.key));
    for (const type of ENGINE_TYPES) {
      expect(displayKeys.has(type)).toBe(true);
    }
  });

  it('every engine event carries a non-empty human-readable label', () => {
    for (const type of ENGINE_TYPES) {
      expect(ENGINE_EVENTS[type].label.length).toBeGreaterThan(0);
    }
  });
});

describe('notificationTypesFor — audience filtering', () => {
  it('includes only entries matching the given audience or audience "all"', () => {
    const adminTypes = notificationTypesFor('admin');
    expect(adminTypes.every((t) => t.audience === 'admin' || t.audience === 'all')).toBe(true);
    expect(adminTypes.some((t) => t.audience === 'worker')).toBe(false);
  });

  it('the engine notification types are all audience "admin" (they concern org management)', () => {
    for (const type of ENGINE_TYPES) {
      const entry = NOTIFICATION_TYPES.find((t) => t.key === type);
      expect(entry?.audience).toBe('admin');
    }
  });
});

/**
 * SET-004: the Settings → Notification category table switches delivery per
 * category, so every catalog type must be classified and every category the UI
 * renders must have a default.
 */
describe('notification categories', () => {
  it('classifies every catalog type into a known category', () => {
    for (const meta of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATEGORIES).toContain(meta.category);
      expect(categoryForNotificationType(meta.key)).toBe(meta.category);
    }
  });

  it('returns null for a type the catalog does not know, so it stays ungated', () => {
    expect(categoryForNotificationType('SOMETHING_UNCLASSIFIED')).toBeNull();
  });

  it('routes the engine types to the categories the settings table advertises', () => {
    expect(categoryForNotificationType('STAFF_ADDED')).toBe('workforce');
    expect(categoryForNotificationType('ROLE_FALLBACK_TRIGGERED')).toBe('workforce');
    expect(categoryForNotificationType('DOCUMENT_UPLOADED')).toBe('documentation');
    expect(categoryForNotificationType('COMPLIANCE_LICENSE_EXPIRING')).toBe('reports');
    expect(categoryForNotificationType('COURSE_ASSIGNED')).toBe('training');
  });

  it('gives every rendered category a row of copy and a shipped default', () => {
    expect(NOTIFICATION_CATEGORY_META.map((meta) => meta.key)).toEqual([
      ...NOTIFICATION_CATEGORIES,
    ]);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(NOTIFICATION_CATEGORY_DEFAULTS[category]).toBeDefined();
    }
  });

  it('keeps the always-on category inside the known set', () => {
    expect(NOTIFICATION_CATEGORIES).toContain(ALWAYS_ON_NOTIFICATION_CATEGORY);
  });
});
