import { SafeguardUsageType } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';

export interface SafeguardAssignmentFields {
  usageType?: SafeguardUsageType;
  startDate?: string;
  endDate?: string;
  mobileAccessories?: string[];
}

export type AuthUser = BranchScopedUser & { id: string };
