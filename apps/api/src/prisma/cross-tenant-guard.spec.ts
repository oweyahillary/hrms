import { blocksCrossTenantWrite } from './tenant-scope';

describe('blocksCrossTenantWrite (by-id tenant guard)', () => {
  const base = {
    model: 'Department', operation: 'update', orgId: 'org-a',
    scopedReadResolved: true, beforeFound: false,
  };
  it('blocks a tenant-scoped update whose scoped read found no in-org row', () => {
    expect(blocksCrossTenantWrite(base)).toBe(true);
  });
  it('blocks a tenant-scoped delete likewise', () => {
    expect(blocksCrossTenantWrite({ ...base, operation: 'delete' })).toBe(true);
  });
  it('allows when the in-org row was found', () => {
    expect(blocksCrossTenantWrite({ ...base, beforeFound: true })).toBe(false);
  });
  it('does not block when the scoped read did not resolve (unknown membership)', () => {
    expect(blocksCrossTenantWrite({ ...base, scopedReadResolved: false })).toBe(false);
  });
  it('ignores non-tenant-scoped / global models', () => {
    expect(blocksCrossTenantWrite({ ...base, model: 'StatutoryRate' })).toBe(false);
  });
  it('ignores when there is no org in context', () => {
    expect(blocksCrossTenantWrite({ ...base, orgId: undefined })).toBe(false);
  });
  it('ignores non update/delete operations', () => {
    expect(blocksCrossTenantWrite({ ...base, operation: 'create' })).toBe(false);
    expect(blocksCrossTenantWrite({ ...base, operation: 'findMany' })).toBe(false);
  });
});
