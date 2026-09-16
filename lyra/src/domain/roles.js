// Role model shared by both tenant types.
//
//   family:  parent_admin | adult | child
//   school:  it_admin     | teacher | student
//
// Properties driving behaviour:
//   * admin      — may manage members (invite, cap, pause). Admins CANNOT read
//                  others' chat content.
//   * billing    — may manage the tenant's subscription/plan. A strict subset of
//                  admins: a classroom teacher administers students but must NOT
//                  touch the school's billing — that is the IT admin's authority.
//   * classroom  — the admin's authority is scoped to their own group
//                  (classroom). A teacher can only provision/manage students in
//                  their classroom, never other staff or the whole school.
//   * supervised — routed through moderation + the Socratic tutor persona.

export const ROLES = {
  parent_admin: { tenantType: 'family', admin: true,  billing: true,  classroom: false, supervised: false },
  adult:        { tenantType: 'family', admin: false, billing: false, classroom: false, supervised: false },
  child:        { tenantType: 'family', admin: false, billing: false, classroom: false, supervised: true },
  it_admin:     { tenantType: 'school', admin: true,  billing: true,  classroom: false, supervised: false },
  teacher:      { tenantType: 'school', admin: true,  billing: false, classroom: true,  supervised: false },
  student:      { tenantType: 'school', admin: false, billing: false, classroom: false, supervised: true },
};

export function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

export function isAdmin(role) {
  return !!ROLES[role]?.admin;
}

// May manage the tenant's billing/subscription (parent_admin, it_admin — NOT a
// classroom teacher).
export function canManageBilling(role) {
  return !!ROLES[role]?.billing;
}

// An admin whose authority is limited to their own classroom (teacher).
export function isClassroomScopedAdmin(role) {
  return !!ROLES[role]?.classroom;
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
