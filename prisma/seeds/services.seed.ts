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
