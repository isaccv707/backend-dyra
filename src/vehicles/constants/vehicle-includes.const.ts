import { Prisma } from '@prisma/client';

export const VEHICLE_ALLOWED_FIELDS = [
  'internalCode',
  'status',
  'condition',
  'createdAt',
];

export const VEHICLE_TRANSFER_ALLOWED_FIELDS = ['status', 'createdAt'];

export const VEHICLE_INCLUDE = {
  catalog: true,
  employee: true,
  location: true,
  currentBranch: { select: { id: true, name: true } },
} satisfies Prisma.VehicleItemInclude;

export const VEHICLE_TRANSFER_INCLUDE = {
  originBranch: { select: { id: true, name: true } },
  destinationBranch: { select: { id: true, name: true } },
  items: {
    include: {
      vehicle: { select: { id: true, internalCode: true, status: true } },
    },
  },
} satisfies Prisma.VehicleTransferRequestInclude;
