import { SafeguardUsageType } from '@prisma/client';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { VehicleSafeguardInspectionItemDto } from 'src/vehicle-safeguards/dto/vehicle-safeguard-inspection-item.dto';

export interface VehicleSafeguardAssignmentFields {
  usageType?: SafeguardUsageType;
  startDate?: string;
  endDate?: string;
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}

export type AuthUser = BranchScopedUser & { id: string };
