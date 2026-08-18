import { PrismaClient } from '@prisma/client';
import { SERVICES } from '../constants/services';

/** Debe ejecutarse después de seedBranches: cada servicio requiere un branchId. */
export async function seedServices(prisma: PrismaClient) {
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchIdByName = new Map(branches.map((b) => [b.name, b.id]));

  for (const service of SERVICES) {
    const branchId = branchIdByName.get(service.branchName);
    if (!branchId) {
      throw new Error(
        `No se encontró la sucursal '${service.branchName}' para el servicio '${service.name}'. Ejecuta seedBranches primero.`,
      );
    }

    // Vinculamos el servicio a la hoja pública de su sucursal (si existe) para
    // que los estudios sembrados en seedStudies muestren precio de inmediato.
    const publicPriceSheet = await prisma.priceSheets.findFirst({
      where: { branchId, isPublic: true },
      select: { id: true },
    });

    await prisma.service.upsert({
      where: { branchId_slug: { branchId, slug: service.slug } },
      update: {
        name: service.name,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
        branchId,
        priceSheetId: publicPriceSheet?.id,
      },
      create: {
        name: service.name,
        slug: service.slug,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
        isActive: true,
        branchId,
        priceSheetId: publicPriceSheet?.id,
        benefits: {
          create: service.benefits,
        },
        details: service.details
          ? {
              create: service.details,
            }
          : undefined,
      },
    });
  }
  console.log('✅ Seeding services finished.');
}
