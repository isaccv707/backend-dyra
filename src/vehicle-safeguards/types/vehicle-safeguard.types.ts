import { Prisma, SafeguardUsageType } from '@prisma/client';
import { getVehicleInspectionItemSection } from '../constants/vehicle-inspection-items.const';
import { VEHICLE_SAFEGUARD_INCLUDE } from '../constants/vehicle-safeguard-query.const';
import { VehicleSafeguardInspectionItemDto } from '../dto/vehicle-safeguard-inspection-item.dto';

export type VehicleSafeguardWithDetails = Prisma.VehicleSafeguardGetPayload<{
  include: typeof VEHICLE_SAFEGUARD_INCLUDE;
}>;

export interface InspectionItemCreateInput {
  itemKey: string;
  section: ReturnType<typeof getVehicleInspectionItemSection>;
  state?: string | null;
  observations?: string | null;
}

export interface CreateFromEmployeeVehicleInput {
  usageType?: SafeguardUsageType;
  startDate?: Date;
  endDate?: Date;
  createdByUserId: string;
  inspectionItems?: VehicleSafeguardInspectionItemDto[];
}
