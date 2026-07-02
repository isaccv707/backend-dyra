export function branchScopeWhere(branchId?: string) {
  if (!branchId) return {};

  return {
    OR: [{ branches: { none: {} } }, { branches: { some: { id: branchId } } }],
  };
}
