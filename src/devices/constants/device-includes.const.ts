import { Prisma } from '@prisma/client';

export const DEVICE_ALLOWED_FIELDS = [
  'internalCode',
  'status',
  'condition',
  'createdAt',
];

export const TRANSFER_ALLOWED_FIELDS = ['status', 'createdAt'];

export const DEVICE_INCLUDE = {
  catalog: true,
  employee: true,
  location: true,
  currentBranch: { select: { id: true, name: true } },
} satisfies Prisma.DeviceItemInclude;

export const TRANSFER_INCLUDE = {
  originBranch: { select: { id: true, name: true } },
  destinationBranch: { select: { id: true, name: true } },
  items: {
    include: {
      device: { select: { id: true, internalCode: true, status: true } },
    },
  },
} satisfies Prisma.TransferRequestInclude;
