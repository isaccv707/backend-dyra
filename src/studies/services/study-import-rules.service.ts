import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ImportRowError, ValidStudyImportRow } from '../types/importRow';

const REQUIRED_CATALOG_COLUMNS = ['section', 'sampleType'] as const;

export type ExistingStudiesByCode = Awaited<
  ReturnType<StudyImportRulesService['rejectAgainstExistingStudies']>
>;

/**
 * Rules that depend on the branch's current studies. Moves the rows that
 * break them from `valid` to `invalid` and returns those studies by code.
 */
@Injectable()
export class StudyImportRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async rejectAgainstExistingStudies(
    branchId: string,
    valid: ValidStudyImportRow[],
    invalid: ImportRowError[],
  ) {
    const existingByCode = new Map(
      (
        await this.prisma.study.findMany({
          where: { branchId, code: { in: valid.map((v) => v.code) } },
          select: {
            code: true,
            slug: true,
            isPanel: true,
            isActive: true,
            _count: { select: { referenceValues: true, parentPanels: true } },
          },
        })
      ).map((s) => [s.code, s]),
    );
    for (let i = valid.length - 1; i >= 0; i--) {
      const item = valid[i];
      const errors: string[] = [];

      const existing = existingByCode.get(item.code);
      if (!existing) {
        const missing = REQUIRED_CATALOG_COLUMNS.filter(
          (field) => !item[field],
        );
        if (missing.length > 0) {
          errors.push(
            `Para crear un estudio nuevo son obligatorias las columnas: ${missing.join(', ')}`,
          );
        }
      }

      if (
        item.isActive === false &&
        existing?.isActive &&
        existing._count.parentPanels > 0
      ) {
        errors.push(
          'No se puede desactivar: el estudio forma parte de uno o más perfiles',
        );
      }

      item.isPanel ??= existing?.isPanel;
      if (item.isPanel) {
        const measurement = [
          ...(item.units !== undefined ? ['units'] : []),
          ...(item.decimals !== undefined ? ['decimals'] : []),
        ];
        if (measurement.length) {
          errors.push(
            `Un perfil (isPanel = true) no puede tener ${measurement.join(' ni ')}`,
          );
        }
        if (existing?._count?.referenceValues) {
          errors.push(
            'No se puede marcar como perfil: el estudio tiene valores de referencia',
          );
        }
      }

      if (errors.length) {
        invalid.push({ row: item.row, code: item.code, errors });
        valid.splice(i, 1);
      }
    }
    invalid.sort((a, b) => a.row - b.row);

    return existingByCode;
  }
}
