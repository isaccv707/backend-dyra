import { PrismaClient } from '@prisma/client';
import { STUDIES } from '../constants/studies';
import {
  catalogNameKey,
  resolveStudyCatalogIds,
} from '../../src/study-catalogs/utils/study-catalog.util';

export async function seedStudies(prisma: PrismaClient) {
  // Get a default service (Análisis Clínicos) to use if the hardcoded one fails.
  // `slug` is scoped per sucursal now, so several branches may have one —
  // any of them works fine as a fallback.
  const defaultService = await prisma.service.findFirst({
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
    const { price, serviceId, sampleType, ...studyData } = study;

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

    // El tipo de muestra es un catálogo por sucursal: se crea si no existe.
    const sampleTypeIds = await resolveStudyCatalogIds(
      prisma,
      'sampleType',
      effectiveService.branchId,
      [sampleType],
      { createMissing: true },
    );
    const sampleTypeId = sampleTypeIds.get(catalogNameKey(sampleType));

    const priceSheetEntries = [
      { price, priceSheetId: branchPriceSheet.id, showPrice: true },
    ];

    await prisma.study.upsert({
      where: {
        branchId_code: {
          branchId: effectiveService.branchId,
          code: study.code,
        },
      },
      update: {
        name: studyData.name,
        description: studyData.description,
        sampleTypeId,
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
        sampleTypeId,
        serviceId: effectiveService.id,
        branchId: effectiveService.branchId,
        priceSheets: { create: priceSheetEntries },
      },
    });
  }
  console.log('✅ Seeding studies with price sheets finished.');
}
