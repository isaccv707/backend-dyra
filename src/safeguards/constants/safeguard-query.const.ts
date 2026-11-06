import { Prisma } from '@prisma/client';

export const SAFEGUARD_ALLOWED_FIELDS = [
  'employeeName',
  'area',
  'usageType',
  'createdAt',
];

export const SAFEGUARD_INCLUDE = {
  employee: {
    select: { id: true, name: true, department: true, position: true },
  },
  computer: { include: { accessoryDetails: true } },
  mobile: { include: { accessoryDetails: true } },
} satisfies Prisma.SafeguardInclude;
