import { PrismaClient } from '@prisma/client';
import { REVIEWS } from '../constants/reviews';

export async function seedReviews(prisma: PrismaClient) {
  for (const review of REVIEWS) {
    const { id, branchName, ...reviewData } = review;

    const branch = await prisma.branch.findFirst({ where: { name: branchName } });
    if (!branch) {
      throw new Error(
        `Sucursal '${branchName}' no encontrada. Ejecuta seedBranches primero.`,
      );
    }

    await prisma.review.upsert({
      where: { id },
      update: { ...reviewData, branchId: branch.id },
      create: { id, ...reviewData, branchId: branch.id },
    });
  }

  console.log('✅ Reviews seeded.');
}
