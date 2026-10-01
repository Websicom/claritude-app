import { describe, expect, it } from 'vitest';
import { AUDIT_REGISTRY } from './audit-registry.generated';

describe('audit registry', () => {
  it('maps every supplied checklist entry to a unique stable id', () => {
    expect(AUDIT_REGISTRY.length).toBe(306);
    expect(new Set(AUDIT_REGISTRY.map((check) => check.id)).size).toBe(AUDIT_REGISTRY.length);
  });

  it('uses only the six supported primary categories', () => {
    const categories = new Set(AUDIT_REGISTRY.map((check) => check.primaryCategory));
    expect([...categories].sort()).toEqual(['accessibility','ai_readiness','infrastructure','performance','security','seo']);
  });

  it('keeps executable configuration separate from source code', () => {
    for (const check of AUDIT_REGISTRY) {
      expect(check).not.toHaveProperty('code');
      expect(check).not.toHaveProperty('sql');
      expect(check.logicVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
