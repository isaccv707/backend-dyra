import { Prisma } from '@prisma/client';

export const SERVICE_ALLOWED_FIELDS = ['name', 'createdAt'];

// Service routes are public: only public, active sheets may expose prices
// (partner sheets are private).
export const PUBLIC_PRICE_SHEET_WHERE = {
  isPublic: true,
  isActive: true,
} satisfies Prisma.PriceSheetsWhereInput;

export const ADMIN_PRICE_SHEET_SELECT = {
  id: true,
  name: true,
  description: true,
  isPublic: true,
  isActive: true,
} satisfies Prisma.PriceSheetsSelect;
