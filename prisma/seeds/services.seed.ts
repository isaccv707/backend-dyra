import { PrismaClient } from '@prisma/client';
import { SERVICES } from '../constants/services';

export async function seedServices(prisma: PrismaClient) {
  for (const service of SERVICES) {
    await prisma.service.upsert({
      where: { slug: service.slug },
      update: {
        name: service.name,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
      },
      create: {
        name: service.name,
        slug: service.slug,
        description: service.description,
        imageUrl: service.imageUrl,
        mobileImageUrl: service.mobileImageUrl,
        isActive: true,
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

/**
 * Debe ejecutarse después de seedBranches: conecta los servicios que
 * declaran `branchNames` a esas sucursales (visibilidad exclusiva).
 * Los servicios sin `branchNames` quedan globales (visibles en todas).
 */
export async function linkServiceBranches(prisma: PrismaClient) {
  for (const service of SERVICES) {
    if (!service.branchNames?.length) continue;

    const branches = await prisma.branch.findMany({
      where: { name: { in: service.branchNames } },
      select: { id: true },
    });

    if (branches.length !== service.branchNames.length) {
      throw new Error(
        `No se encontraron todas las sucursales para el servicio '${service.name}'. Ejecuta seedBranches primero.`,
      );
    }

    await prisma.service.update({
      where: { slug: service.slug },
      data: { branches: { set: branches.map((b) => ({ id: b.id })) } },
    });
  }

  console.log('✅ Service-branch links seeded.');
}
