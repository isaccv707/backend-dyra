import { Prisma } from '@prisma/client';

export function importErrorMessage(error: unknown): string {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return 'Ya existe otro estudio en la sucursal con el mismo código o slug; vuelve a importar el archivo';
  }
  return error instanceof Error ? error.message : String(error);
}
