import { Prisma } from '@prisma/client';

export const QUOTATION_ALLOWED_FIELDS = [
  'folio',
  'name',
  'lastName',
  'phoneNumber',
  'total',
  'createdAt',
  'priceSheet.name',
];

export const QUOTATION_BRANCH_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: {
    select: {
      street: true,
      extNumber: true,
      intNumber: true,
      neighborhood: true,
      city: true,
      zipCode: true,
    },
  },
} satisfies Prisma.BranchSelect;
