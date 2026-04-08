import { PrismaClient } from '@prisma/client';
import { STUDIES } from '../constants/studies';

export async function seedStudies(prisma: PrismaClient) {
  const jalisco = await prisma.state.findUnique({ where: { name: 'Jalisco' } });
  const colima = await prisma.state.findUnique({ where: { name: 'Colima' } });

  if (!jalisco || !colima) {
    throw new Error('Debes ejecutar seedStates antes que seedStudies');
  }

  for (const study of STUDIES) {
    const { price, ...studyData } = study;

    await prisma.study.upsert({
      where: { code: study.code },
      update: {
        name: studyData.name,
        description: studyData.description,
        sampleType: studyData.sampleType,
        deliveryTime: studyData.deliveryTime,
        preparation: studyData.preparation,
        isActive: studyData.isActive,
        serviceId: studyData.serviceId,
      },
      create: {
        ...studyData,
        studyPrices: {
          create: [
            {
              price: price,
              stateId: jalisco.id,
              showPrice: true,
            },
            {
              price: 0,
              stateId: colima.id,
              showPrice: false, // Oculto en Colima
            },
          ],
        },
      },
    });
  }
  console.log('✅ Seeding studies with prices finished.');
}
