/**
 * Role and permission storage.
 *
 * Roles live in `roles`; what each role can see/do lives in `role_permissions`
 * keyed by the feature catalogue from `@helpdesk/shared`. The `admin` role
 * always has every feature regardless of rows, so an admin can never lock
 * themselves out of the console.
 */
import { eq, sql } from 'drizzle-orm';
import {
  FEATURE_KEYS,
  defaultPermissionFor,
  FALLBACK_ROLE_KEY,
  isFeatureKey,
} from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { rolePermissions, roles, users, type User } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { log } from '../logging/service.js';

export interface RoleWithPermissions {
  id: string;
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  createdAt: Date;
  permissions: { featureKey: string; enabled: boolean }[];
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

export async function seedRolesPermissions(): Promise<void> {
  const defaults: { key: string; label: string; description: string }[] = [
    {
      key: 'admin',
      label: 'Administrator',
      description: 'Full access to every tab and action. Cannot be deleted.',
    },
    {
      key: FALLBACK_ROLE_KEY,
      label: 'Viewer',
      description: 'Read-only console access. Cannot be deleted.',
    },
  ];

  for (const spec of defaults) {
    const existing = await db.select().from(roles).where(eq(roles.key, spec.key)).limit(1);
    let roleId = existing[0]?.id;
    if (!roleId) {
      const created = await db
        .insert(roles)
        .values({ key: spec.key, label: spec.label, description: spec.description, isSystem: true })
        .onConflictDoNothing({ target: roles.key })
        .returning();
      roleId = created[0]?.id;
      if (!roleId) {
        const fresh = await db.select().from(roles).where(eq(roles.key, spec.key)).limit(1);
        roleId = fresh[0]?.id;
      }
    }
    if (!roleId) continue;

    await db
      .insert(rolePermissions)
      .values(
        FEATURE_KEYS.map((featureKey) => ({
          roleId,
          featureKey,
          enabled: defaultPermissionFor(featureKey, spec.key),
        })),
      )
      .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.featureKey] });
  }

  log.info({ roles: defaults.length, features: FEATURE_KEYS.length }, 'Seeded roles and permissions');
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function featuresForRole(roleKey: string): Promise<string[]> {
  if (roleKey === 'admin') return [...FEATURE_KEYS];
  const rows = await permissionRowsForRole(roleKey);
  const byKey = new Map(rows.map((row) => [row.featureKey, row.enabled]));
  return FEATURE_KEYS.filter((key) => byKey.get(key) ?? defaultPermissionFor(key, roleKey));
}

/** Whether a (possibly non-admin) user may access a tab/action. */
export async function hasFeature(user: User, featureKey: string): Promise<boolean> {
  if (user.role === 'admin') return true;
  const allowed = await featuresForRole(user.role);
  return allowed.includes(featureKey);
}

async function permissionRowsForRole(roleKey: string) {
  const role = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role[0]) return [];
  return db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role[0].id));
}

export async function listRoles(): Promise<RoleWithPermissions[]> {
  const [roleRows, permRows, counts] = await Promise.all([
    db.select().from(roles).orderBy(roles.createdAt),
    db.select().from(rolePermissions),
    db.select({ role: users.role, count: sql<number>`count(*)::int` }).from(users).groupBy(users.role),
  ]);

  const permsByRole = new Map<string, Map<string, boolean>>();
  for (const row of permRows) {
    const map = permsByRole.get(row.roleId) ?? new Map<string, boolean>();
    map.set(row.featureKey, row.enabled);
    permsByRole.set(row.roleId, map);
  }
  const countByRole = new Map<string, number>();
  for (const row of counts) countByRole.set(row.role, Number(row.count ?? 0));

  return roleRows.map((role) => ({
    id: role.id,
    key: role.key,
    label: role.label,
    description: role.description,
    isSystem: role.isSystem,
    userCount: countByRole.get(role.key) ?? 0,
    createdAt: role.createdAt,
    permissions: FEATURE_KEYS.map((featureKey) => ({
      featureKey,
      enabled: permsByRole.get(role.id)?.get(featureKey) ?? defaultPermissionFor(featureKey, role.key),
    })),
  }));
}

/* ------------------------------------------------------------------ */
/* Writes (administrator only)                                        */
/* ------------------------------------------------------------------ */

export async function createRole(input: { key: string; label: string; description?: string }): Promise<RoleWithPermissions> {
  const created = await db
    .insert(roles)
    .values({ key: input.key, label: input.label, description: input.description ?? null })
    .onConflictDoNothing({ target: roles.key })
    .returning();
  const role = created[0];
  if (!role) throw AppError.conflict('A role with that key already exists');

  await db
    .insert(rolePermissions)
    .values(
      FEATURE_KEYS.map((featureKey) => ({
        roleId: role.id,
        featureKey,
        enabled: defaultPermissionFor(featureKey, role.key),
      })),
    )
    .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.featureKey] });

  const all = await listRoles();
  return all.find((row) => row.id === role.id) as RoleWithPermissions;
}

export async function updateRole(
  id: string,
  input: { label?: string; description?: string | null },
): Promise<RoleWithPermissions> {
  const role = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role[0]) throw AppError.notFound('Role not found');

  await db
    .update(roles)
    .set({
      label: input.label ?? role[0].label,
      description: input.description ?? role[0].description,
    })
    .where(eq(roles.id, id));

  const all = await listRoles();
  return all.find((row) => row.id === id) as RoleWithPermissions;
}

export async function deleteRole(id: string): Promise<void> {
  const role = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role[0]) throw AppError.notFound('Role not found');
  if (role[0].isSystem) throw AppError.conflict('System roles cannot be deleted');

  const assignedCount = await countUsersWithRole(role[0].key);
  if (assignedCount > 0) {
    throw AppError.conflict(
      `"${role[0].label}" is assigned to ${assignedCount} user(s). Move them to another role first.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    await tx.delete(roles).where(eq(roles.id, id));
  });
}

export async function setRolePermissions(
  id: string,
  permissions: { featureKey: string; enabled: boolean }[],
): Promise<RoleWithPermissions> {
  const role = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role[0]) throw AppError.notFound('Role not found');
  if (role[0].key === 'admin') {
    throw AppError.forbidden('Administrator permissions are managed by the system');
  }
  const roleRow = role[0];

  const unknown = permissions.map((permission) => permission.featureKey).filter((key) => !isFeatureKey(key));
  if (unknown.length > 0) {
    throw AppError.validation(`Unknown feature key(s): ${unknown.join(', ')}`);
  }

  const enabledByKey = new Map(permissions.map((permission) => [permission.featureKey, permission.enabled]));

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    for (const featureKey of FEATURE_KEYS) {
      await tx
        .insert(rolePermissions)
        .values({
          roleId: id,
          featureKey,
          enabled: enabledByKey.get(featureKey) ?? defaultPermissionFor(featureKey, roleRow.key),
        })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.featureKey] });
    }
  });

  const all = await listRoles();
  return all.find((row) => row.id === id) as RoleWithPermissions;
}

async function countUsersWithRole(roleKey: string): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, roleKey));
  return rows.length;
}