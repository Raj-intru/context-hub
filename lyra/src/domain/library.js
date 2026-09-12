// The well-known tenant that holds shared curriculum packs (read under its own
// tenant context, so no RLS is relaxed). Seeded by db/init.sql.
export const LIBRARY_TENANT_ID = '00000000-0000-4000-8000-000000000001';
// Synthetic actor id used when reading/writing the library (any uuid; the
// library's chunk RLS keys on tenant, not user).
export const LIBRARY_ACTOR_ID = '00000000-0000-4000-8000-000000000002';

export function libraryContext() {
  return { id: LIBRARY_ACTOR_ID, tenant_id: LIBRARY_TENANT_ID, role: 'it_admin' };
}
