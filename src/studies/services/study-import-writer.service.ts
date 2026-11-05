import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { generateSlug } from 'src/common/utils/slugger.util';
import {
  catalogNameKey,
  resolveStudyCatalogIds,
} from 'src/study-catalogs/utils/study-catalog.util';
import { ValidStudyImportRow } from '../types/importRow';
import { importErrorMessage } from '../utils/study-import-error.util';
import { ExistingStudiesByCode } from './study-import-rules.service';

/** Creates or updates each valid row's study, with its catalogs and slug. */
@Injectable()
export class StudyImportWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertStudies(
    branchId: string,
    valid: ValidStudyImportRow[],
    existingByCode: ExistingStudiesByCode,
  ) {
    let processed = 0;
    let created = 0;
    let updated = 0;
    const importErrors: Array<{ code: string; error: string }> = [];
    const processedCodes = new Set<string>();

    const panelsWithChildren = new Set(
      (
        await this.prisma.study.findMany({
          where: {
            branchId,
            code: {
              in: valid.filter((v) => v.isPanel === false).map((v) => v.code),
            },
            panelItems: { some: {} },
          },
          select: { code: true },
        })
      ).map((s) => s.code),
    );

    const catalogNames = (field: 'section' | 'sampleType' | 'technique') =>
      valid.flatMap((v) => (v[field] ? [v[field]] : []));
    const [sectionIds, sampleTypeIds, techniqueIds] = await Promise.all([
      resolveStudyCatalogIds(
        this.prisma,
        'section',
        branchId,
        catalogNames('section'),
        { createMissing: true },
      ),
      resolveStudyCatalogIds(
        this.prisma,
        'sampleType',
        branchId,
        catalogNames('sampleType'),
        { createMissing: true },
      ),
      resolveStudyCatalogIds(
        this.prisma,
        'technique',
        branchId,
        catalogNames('technique'),
        { createMissing: true },
      ),
    ]);
    const connectCatalog = (ids: Map<string, number>, name?: string) => {
      const id = name ? ids.get(catalogNameKey(name)) : undefined;
      return id ? { connect: { id } } : undefined;
    };

    const slugByCode = await this.assignNewStudySlugs(
      branchId,
      valid.filter((v) => !existingByCode.has(v.code)),
    );

    for (const item of valid) {
      if (panelsWithChildren.has(item.code)) {
        importErrors.push({
          code: item.code,
          error:
            'No se puede desmarcar como perfil: aún tiene estudios hijos. Elimínalos primero.',
        });
        continue;
      }

      try {
        // Renaming never changes the slug: it's only set when the study is created.
        // A blank `title` cell keeps the current title (or defaults to `name` on create).
        await this.prisma.study.upsert({
          where: { branchId_code: { branchId, code: item.code } },
          update: {
            name: item.name,
            title: item.title,
            description: item.description,
            sampleType: connectCatalog(sampleTypeIds, item.sampleType),
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive,
            abbreviation: item.abbreviation,
            section: connectCatalog(sectionIds, item.section),
            technique: connectCatalog(techniqueIds, item.technique),
            isPanel: item.isPanel,
            gender: item.gender,
            ageFormat: item.ageFormat,
            minAge: item.minAge,
            maxAge: item.maxAge,
            ...(item.isPanel
              ? { units: null, decimals: null }
              : { units: item.units, decimals: item.decimals }),
            service: { connect: { id: item.serviceId } },
          },
          create: {
            name: item.name,
            title: item.title ?? item.name,
            // Prisma validates `create` even when the row exists, so existing
            // studies pass their current slug (it is never written).
            slug:
              slugByCode.get(item.code) ?? existingByCode.get(item.code)!.slug,
            code: item.code,
            description: item.description,
            sampleType: connectCatalog(sampleTypeIds, item.sampleType),
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive ?? true,
            abbreviation: item.abbreviation,
            section: connectCatalog(sectionIds, item.section),
            technique: connectCatalog(techniqueIds, item.technique),
            isPanel: item.isPanel,
            gender: item.gender,
            ageFormat: item.ageFormat,
            minAge: item.minAge,
            maxAge: item.maxAge,
            units: item.isPanel ? null : item.units,
            decimals: item.isPanel ? null : item.decimals,
            service: { connect: { id: item.serviceId } },
            branch: { connect: { id: branchId } },
          },
        });

        processed++;
        if (existingByCode.has(item.code)) updated++;
        else created++;
        processedCodes.add(item.code);
      } catch (error) {
        importErrors.push({
          code: item.code,
          error: importErrorMessage(error),
        });
      }
    }

    return { processed, created, updated, importErrors, processedCodes };
  }

  /**
   * Slugs for the studies this import will create. Parameters of different
   * panels often share a name ("Glucosa", "pH"), so instead of failing on a
   * taken slug it falls back to `<name>-<code>` (and a numeric suffix as a
   * last resort), checking both the branch and earlier rows of the file.
   */
  private async assignNewStudySlugs(
    branchId: string,
    newStudies: Array<{ code: string; name: string }>,
  ): Promise<Map<string, string>> {
    const slugByCode = new Map<string, string>();
    if (!newStudies.length) return slugByCode;

    const taken = new Set(
      (
        await this.prisma.study.findMany({
          where: { branchId },
          select: { slug: true },
        })
      ).map((s) => s.slug),
    );

    for (const { code, name } of newStudies) {
      const base = generateSlug(name) || generateSlug(code);
      let slug = base;
      if (taken.has(slug)) {
        const withCode = generateSlug(`${name} ${code}`) || base;
        slug = withCode;
        for (let n = 2; taken.has(slug); n++) slug = `${withCode}-${n}`;
      }
      taken.add(slug);
      slugByCode.set(code, slug);
    }

    return slugByCode;
  }
}
