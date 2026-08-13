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

    await prisma.service.upsert({
      where: { branchId_slug: { branchId, slug: service.slug } },
      update: {
        name: service.name,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
        branchId,
      },
      create: {
        name: service.name,
        slug: service.slug,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
        isActive: true,
        branchId,
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
