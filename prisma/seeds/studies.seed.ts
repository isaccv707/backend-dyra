import { PrismaClient } from '@prisma/client';
import { STUDIES } from '../constants/studies';
import { PRICE_SHEETS } from '../constants/price-sheets';

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

  // Las PriceSheets de Jalisco y Colima ya fueron creadas por seedBranches
  // (ahora cada hoja de precios pertenece a una sucursal).
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

    const priceSheetEntries = [
      { price, priceSheetId: PRICE_SHEETS.JALISCO.id, showPrice: true },
      { price: 0, priceSheetId: PRICE_SHEETS.COLIMA.id, showPrice: false },
    ];

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
        priceSheets: {
          deleteMany: {},
          create: priceSheetEntries,
        },
      },
      create: {
        ...studyData,
        serviceId: effectiveServiceId,
        priceSheets: { create: priceSheetEntries },
      },
    });
  }
  console.log('✅ Seeding studies with price sheets finished.');
}
