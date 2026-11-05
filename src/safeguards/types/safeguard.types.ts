import { Prisma, SafeguardUsageType } from '@prisma/client';
import { SAFEGUARD_INCLUDE } from '../constants/safeguard-query.const';

export type SafeguardWithDetails = Prisma.SafeguardGetPayload<{
  include: typeof SAFEGUARD_INCLUDE;
}>;

export interface CreateFromEmployeeDevicesInput {
  usageType?: SafeguardUsageType;
  startDate?: Date;
  endDate?: Date;
  createdByUserId: string;
  mobileAccessories?: string[];
}
