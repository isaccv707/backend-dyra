import { PrismaClient } from '@prisma/client';
import { BANNERS } from '../constants/banners';

export async function seedBanners(prisma: PrismaClient) {
  for (const banner of BANNERS) {
    const { id, branchName, ...bannerData } = banner;

    const branch = await prisma.branch.findFirst({
      where: { name: branchName },
    });
    if (!branch) {
      throw new Error(
        `Sucursal '${branchName}' no encontrada. Ejecuta seedBranches primero.`,
      );
    }

    await prisma.banner.upsert({
      where: { id },
      update: {
        ...bannerData,
        branchId: branch.id,
      },
      create: {
        id,
        ...bannerData,
        branchId: branch.id,
      },
    });
  }

  console.log('✅ Banners seeded.');
}
