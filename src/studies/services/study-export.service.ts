import { Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { REFERENCE_VALUES_INCLUDE } from '../constants/study-includes.const';
import { studyTitle } from '../utils/study-title.util';

/** Excel export of a branch's studies. */
@Injectable()
export class StudyExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportByBranch(
    branchId: string,
    user: BranchScopedUser,
  ): Promise<{ buffer: Buffer; branchName: string }> {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${branchId} no encontrada`,
      );
    }

    const [studies, priceSheets] = await Promise.all([
      this.prisma.study.findMany({
        where: { branchId },
        select: {
          id: true,
          code: true,
          abbreviation: true,
          name: true,
          title: true,
          slug: true,
          isActive: true,
          description: true,
          preparation: true,
          service: { select: { name: true } },
          section: { select: { name: true } },
          sampleType: { select: { name: true } },
          technique: { select: { name: true } },
          isPanel: true,
          panelItems: {
            orderBy: { order: 'asc' },
            select: { child: { select: { code: true } } },
          },
          parentPanels: {
            orderBy: { panel: { code: 'asc' } },
            select: { panel: { select: { code: true } } },
          },
          gender: true,
          ageFormat: true,
          minAge: true,
          maxAge: true,
          units: true,
          decimals: true,
          isInternal: true,
          provider: { select: { name: true } },
          providerCost: true,
          deliveryTime: true,
          createdAt: true,
          updatedAt: true,
          priceSheets: {
            select: { priceSheetId: true, price: true, showPrice: true },
          },
          referenceValues: REFERENCE_VALUES_INCLUDE,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.priceSheets.findMany({
        where: { branchId },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    type ExportedStudy = (typeof studies)[number];
    type Column<T> = { header: string; value: (row: T) => string | number };

    const priceColumns: Column<ExportedStudy>[] = priceSheets.map((sheet) => ({
      header: `Precio: ${sheet.name}${sheet.isActive ? '' : ' (inactiva)'}`,
      value: (s) => {
        const entry = s.priceSheets.find((p) => p.priceSheetId === sheet.id);
        if (!entry) return '';
        return entry.showPrice
          ? Number(entry.price)
          : `${Number(entry.price)} (oculto)`;
      },
    }));

    const studyColumns: Column<ExportedStudy>[] = [
      { header: 'Código', value: (s) => s.code },
      { header: 'Abreviatura', value: (s) => s.abbreviation ?? '' },
      { header: 'Nombre', value: (s) => s.name },
      { header: 'Título', value: (s) => studyTitle(s) },
      { header: 'Slug', value: (s) => s.slug },
      { header: 'Activo', value: (s) => (s.isActive ? 'Sí' : 'No') },
      { header: 'Servicio', value: (s) => s.service.name },
      { header: 'Sección', value: (s) => s.section?.name ?? '' },
      { header: 'Tipo de muestra', value: (s) => s.sampleType?.name ?? '' },
      { header: 'Técnica', value: (s) => s.technique?.name ?? '' },
      { header: 'Es perfil', value: (s) => (s.isPanel ? 'Sí' : 'No') },
      {
        header: 'Parámetros',
        value: (s) => s.panelItems.map((i) => i.child.code).join(','),
      },
      {
        header: 'Forma parte de',
        value: (s) => s.parentPanels.map((p) => p.panel.code).join(','),
      },
      {
        header: 'Vendible',
        value: (s) => (s.priceSheets.length > 0 ? 'Sí' : 'No'),
      },
      { header: 'Género', value: (s) => s.gender },
      { header: 'Formato de edad', value: (s) => s.ageFormat },
      { header: 'Edad mínima', value: (s) => s.minAge },
      { header: 'Edad máxima', value: (s) => s.maxAge },
      { header: 'Unidades', value: (s) => s.units ?? '' },
      { header: 'Decimales', value: (s) => s.decimals ?? '' },
      { header: 'Interno', value: (s) => (s.isInternal ? 'Sí' : 'No') },
      { header: 'Maquilador', value: (s) => s.provider?.name ?? '' },
      {
        header: 'Costo maquilador',
        value: (s) => (s.providerCost !== null ? Number(s.providerCost) : ''),
      },
      {
        header: 'Tiempo de entrega (días)',
        value: (s) => s.deliveryTime ?? '',
      },
      { header: 'Descripción', value: (s) => s.description ?? '' },
      { header: 'Preparación', value: (s) => s.preparation ?? '' },
      ...priceColumns,
      {
        header: 'Creado',
        value: (s) => s.createdAt.toISOString().slice(0, 10),
      },
      {
        header: 'Actualizado',
        value: (s) => s.updatedAt.toISOString().slice(0, 10),
      },
    ];

    type ExportedReferenceValue = ExportedStudy['referenceValues'][number] & {
      studyCode: string;
      studyName: string;
      studyUnits: string | null;
    };
    const referenceColumns: Column<ExportedReferenceValue>[] = [
      { header: 'Código del estudio', value: (r) => r.studyCode },
      { header: 'Nombre del estudio', value: (r) => r.studyName },
      { header: 'Orden', value: (r) => r.order + 1 },
      {
        header: 'Tipo',
        value: (r) => (r.text !== null ? 'Cualitativo' : 'Cuantitativo'),
      },
      { header: 'Género', value: (r) => r.gender ?? '' },
      { header: 'Unidad de edad', value: (r) => r.unitAge ?? '' },
      { header: 'Edad mínima', value: (r) => r.minAge ?? '' },
      { header: 'Edad máxima', value: (r) => r.maxAge ?? '' },
      {
        header: 'Valor mínimo',
        value: (r) => (r.minValue !== null ? Number(r.minValue) : ''),
      },
      {
        header: 'Valor máximo',
        value: (r) => (r.maxValue !== null ? Number(r.maxValue) : ''),
      },
      { header: 'Unidades', value: (r) => r.studyUnits ?? '' },
      { header: 'Texto', value: (r) => r.text ?? '' },
      {
        header: 'Fecha',
        value: (r) => r.date.toISOString().slice(0, 10),
      },
    ];
    const referenceValues = studies.flatMap((s) =>
      s.referenceValues.map((r) => ({
        ...r,
        studyCode: s.code,
        studyName: s.name,
        studyUnits: s.units,
      })),
    );

    const toSheet = <T>(columns: Column<T>[], rows: T[]) =>
      XLSX.utils.aoa_to_sheet([
        columns.map((c) => c.header),
        ...rows.map((row) => columns.map((c) => c.value(row))),
      ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      toSheet(studyColumns, studies),
      'Estudios',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      toSheet(referenceColumns, referenceValues),
      'Valores de referencia',
    );

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    return { buffer, branchName: branch.name };
  }
}
