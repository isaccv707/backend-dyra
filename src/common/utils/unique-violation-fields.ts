import { Prisma } from '@prisma/client';

// Campos que violaron el unique de un P2002. Prisma 7 + adapter-pg ya no
// llena meta.target: los reporta en meta.driverAdapterError.cause.constraint.
export const getUniqueViolationFields = (
  error: Prisma.PrismaClientKnownRequestError,
): string[] => {
  const meta = error.meta as
    | {
        target?: string | string[];
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[] } };
        };
      }
    | undefined;

  const adapterFields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (adapterFields?.length) return adapterFields;

  const target = meta?.target;
  if (Array.isArray(target)) return target;
  return target ? [target] : [];
};
