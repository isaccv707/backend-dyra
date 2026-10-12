import { ForbiddenException } from '@nestjs/common';

export interface BranchScopedUser {
  branches?: { id: string }[];
}

function getUserBranchIds(user: BranchScopedUser): string[] {
  return user.branches?.map((b) => b.id) ?? [];
}

export function assertBranchAccess(
  user: BranchScopedUser,
  branchId?: string | null,
) {
  const allowedIds = getUserBranchIds(user);
  if (allowedIds.length === 0) return;

  if (!branchId || !allowedIds.includes(branchId)) {
    throw new ForbiddenException('No tienes acceso a esta sucursal');
  }
}

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
