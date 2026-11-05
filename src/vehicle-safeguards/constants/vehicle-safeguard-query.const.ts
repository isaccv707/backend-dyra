import { Prisma } from '@prisma/client';

export const VEHICLE_SAFEGUARD_ALLOWED_FIELDS = [
  'employeeName',
  'area',
  'usageType',
  'createdAt',
];

export const VEHICLE_SAFEGUARD_INCLUDE = {
  employee: {
    select: { id: true, name: true, department: true, position: true },
  },
  inspectionItems: true,
} satisfies Prisma.VehicleSafeguardInclude;
