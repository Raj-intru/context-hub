import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, isSupervised, rolesForTenantType, roleMatchesTenant, ownerRoleFor,
  canManageBilling, isClassroomScopedAdmin } from '../src/domain/roles.js';

test('admin roles are classified correctly', () => {
  assert.equal(isAdmin('parent_admin'), true);
  assert.equal(isAdmin('it_admin'), true);
  assert.equal(isAdmin('teacher'), true);
  assert.equal(isAdmin('child'), false);
  assert.equal(isAdmin('student'), false);
  assert.equal(isAdmin('adult'), false);
});

test('billing is a strict subset of admin — teacher excluded', () => {
  assert.equal(canManageBilling('parent_admin'), true);
  assert.equal(canManageBilling('it_admin'), true);
  assert.equal(canManageBilling('teacher'), false); // admin, but not for billing
  assert.equal(canManageBilling('student'), false);
});

test('only the teacher is a classroom-scoped admin', () => {
  assert.equal(isClassroomScopedAdmin('teacher'), true);
  assert.equal(isClassroomScopedAdmin('it_admin'), false);
  assert.equal(isClassroomScopedAdmin('parent_admin'), false);
  assert.equal(isClassroomScopedAdmin('student'), false);
});

test('supervised roles are child and student only', () => {
  assert.equal(isSupervised('child'), true);
  assert.equal(isSupervised('student'), true);
  assert.equal(isSupervised('adult'), false);
  assert.equal(isSupervised('teacher'), false);
});

test('roles are scoped to tenant type', () => {
  assert.deepEqual(rolesForTenantType('family').sort(), ['adult', 'child', 'parent_admin']);
  assert.deepEqual(rolesForTenantType('school').sort(), ['it_admin', 'student', 'teacher']);
  assert.equal(roleMatchesTenant('student', 'family'), false);
  assert.equal(roleMatchesTenant('student', 'school'), true);
  assert.equal(ownerRoleFor('school'), 'it_admin');
  assert.equal(ownerRoleFor('family'), 'parent_admin');
});
