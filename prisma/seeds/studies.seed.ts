import { PrismaClient } from '@prisma/client';
import { STUDIES } from '../constants/studies';

export async function seedStudies(prisma: PrismaClient) {
  // Get a default service (Análisis Clínicos) to use if the hardcoded one fails
  const defaultService = await prisma.service.findUnique({
    where: { slug: 'analisis-clinicos' },
  });

  if (!defaultService) {
    throw new Error(
      'Debes ejecutar seedServices antes que seedStudies y asegurar que existe el servicio "analisis-clinicos"',
    );
  }

  // Create or get PriceSheets for Jalisco and Colima
  const jaliscoSheet = await prisma.priceSheets.upsert({
    where: { id: 'jalisco-sheet-id' }, // Just a stable ID for seeding
    update: {},
    create: {
      id: 'jalisco-sheet-id',
      name: 'Lista de Precios Jalisco',
      description: 'Precios para sucursales en Jalisco',
    },
  });

  const colimaSheet = await prisma.priceSheets.upsert({
    where: { id: 'colima-sheet-id' },
    update: {},
    create: {
      id: 'colima-sheet-id',
      name: 'Lista de Precios Colima',
      description: 'Precios para sucursales en Colima',
    },
  });

  for (const study of STUDIES) {
    const { price, serviceId, ...studyData } = study;

    // Check if the serviceId exists, if not use defaultService.id
    let effectiveServiceId = serviceId;
    const existingService = await prisma.service.findUnique({
      where: { id: serviceId },
    });
    if (!existingService) {
      effectiveServiceId = defaultService.id;
    }

    await prisma.study.upsert({
      where: { code: study.code },
      update: {
        name: studyData.name,
        description: studyData.description,
        sampleType: studyData.sampleType,
        deliveryTime: studyData.deliveryTime,
        preparation: studyData.preparation,
        isActive: studyData.isActive,
        serviceId: effectiveServiceId,
      },
      create: {
        ...studyData,
        serviceId: effectiveServiceId,
        priceSheets: {
          create: [
            {
              price: price,
              priceSheetId: jaliscoSheet.id,
              showPrice: true,
            },
            {
              price: 0,
              priceSheetId: colimaSheet.id,
              showPrice: false, // Oculto en Colima
            },
          ],
        },
      },
    });
  }
  console.log('✅ Seeding studies with price sheets finished.');
}
