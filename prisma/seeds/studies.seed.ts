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

  // Un estudio pertenece a la misma sucursal que su Service — es ajeno al
  // resto de sucursales, incluso si otra sucursal tiene un estudio con el
  // mismo código.
  for (const study of STUDIES) {
    const { price, serviceId, ...studyData } = study;

    const existingService = await prisma.service.findUnique({
      where: { id: serviceId },
    });
    const effectiveService = existingService ?? defaultService;

    const branchPriceSheet = await prisma.priceSheets.findFirst({
      where: { branchId: effectiveService.branchId, isPublic: true },
    });
    if (!branchPriceSheet) {
      throw new Error(
        `La sucursal del servicio '${effectiveService.name}' no tiene una hoja de precios pública. Ejecuta seedBranches primero.`,
      );
    }

    const priceSheetEntries = [
      { price, priceSheetId: branchPriceSheet.id, showPrice: true },
    ];

    await prisma.study.upsert({
      where: {
        branchId_code: { branchId: effectiveService.branchId, code: study.code },
      },
      update: {
        name: studyData.name,
        description: studyData.description,
        sampleType: studyData.sampleType,
        deliveryTime: studyData.deliveryTime,
        preparation: studyData.preparation,
        isActive: studyData.isActive,
        serviceId: effectiveService.id,
        branchId: effectiveService.branchId,
        priceSheets: {
          deleteMany: {},
          create: priceSheetEntries,
        },
      },
      create: {
        ...studyData,
        serviceId: effectiveService.id,
        branchId: effectiveService.branchId,
        priceSheets: { create: priceSheetEntries },
      },
    });
  }
  console.log('✅ Seeding studies with price sheets finished.');
}
