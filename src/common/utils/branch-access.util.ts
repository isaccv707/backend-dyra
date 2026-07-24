import { ForbiddenException } from '@nestjs/common';

export interface BranchScopedUser {
  branches?: { id: string }[];
}

function getUserBranchIds(user: BranchScopedUser): string[] {
  return user.branches?.map((b) => b.id) ?? [];
}

/**
 * Throws if the user has restricted branches assigned and `branchId` isn't
 * one of them. A user with no branches assigned is global (unrestricted).
 */
export function assertBranchAccess(user: BranchScopedUser, branchId?: string | null) {
  const allowedIds = getUserBranchIds(user);
  if (allowedIds.length === 0) return;

  if (!branchId || !allowedIds.includes(branchId)) {
    throw new ForbiddenException('No tienes acceso a esta sucursal');
  }
}

/**
 * Resolves a Prisma `branchId` filter scoped to the user's assigned branches.
 * - Global user (no branches assigned): uses `branchId` as-is (or no filter).
 * - Branch-restricted user + explicit `branchId`: must be one of their branches.
 * - Branch-restricted user + no `branchId`: defaults to all their branches.
 */
export function userBranchFilter(user: BranchScopedUser, branchId?: string) {
  const allowedIds = getUserBranchIds(user);

  if (allowedIds.length === 0) {
    return branchId ? { branchId } : {};
  }

  if (branchId) {
    assertBranchAccess(user, branchId);
    return { branchId };
  }

  return { branchId: { in: allowedIds } };
}
