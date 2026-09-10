// Role model shared by both tenant types.
//
//   family:  parent_admin | adult | child
//   school:  it_admin     | teacher | student
//
// Two orthogonal properties drive behaviour:
//   * admin      — may manage the tenant (invite members, allocate credits,
//                  pause users). Admins CANNOT read others' chat content.
//   * supervised — routed through moderation + the Socratic tutor persona.

export const ROLES = {
  parent_admin: { tenantType: 'family', admin: true, supervised: false },
  adult:        { tenantType: 'family', admin: false, supervised: false },
  child:        { tenantType: 'family', admin: false, supervised: true },
  it_admin:     { tenantType: 'school', admin: true, supervised: false },
  teacher:      { tenantType: 'school', admin: true, supervised: false },
  student:      { tenantType: 'school', admin: false, supervised: true },
};

export function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

export function isAdmin(role) {
  return !!ROLES[role]?.admin;
}

export function isSupervised(role) {
  return !!ROLES[role]?.supervised;
}

export function rolesForTenantType(type) {
  return Object.entries(ROLES)
    .filter(([, v]) => v.tenantType === type)
    .map(([k]) => k);
}

export function roleMatchesTenant(role, tenantType) {
  return ROLES[role]?.tenantType === tenantType;
}

// The role that owns billing for a freshly created tenant.
export function ownerRoleFor(tenantType) {
  return tenantType === 'school' ? 'it_admin' : 'parent_admin';
}
