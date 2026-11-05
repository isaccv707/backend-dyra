import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { StudyImportPanelsService } from './services/study-import-panels.service';
import { StudyImportParserService } from './services/study-import-parser.service';
import { StudyImportRulesService } from './services/study-import-rules.service';
import { StudyImportTemplateService } from './services/study-import-template.service';
import { StudyImportWriterService } from './services/study-import-writer.service';

/**
 * Bulk create/update of a branch's studies from an Excel file, keyed by
 * `code` (`POST /studies/import`). Never assigns prices: those are loaded per
 * price sheet with `PriceSheetPriceImportService`.
 */
@Injectable()
export class StudyExcelImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly template: StudyImportTemplateService,
    private readonly parser: StudyImportParserService,
    private readonly rules: StudyImportRulesService,
    private readonly writer: StudyImportWriterService,
    private readonly panels: StudyImportPanelsService,
  ) {}

  async assertImportableBranch(branchId: string, user: BranchScopedUser) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${branchId} no encontrada`,
      );
    }
  }

  generateTemplate(branchId: string): Promise<Buffer> {
    return this.template.generateTemplate(branchId);
  }

  /**
   * File checks → branch rules → panel cycles → upserts → panel children, in
   * that order: a rejected row is never saved.
   */
  async importStudies(branchId: string, buffer: Buffer) {
    const { rows, valid, invalid } = await this.parser.parseRows(
      branchId,
      buffer,
    );
    const existingByCode = await this.rules.rejectAgainstExistingStudies(
      branchId,
      valid,
      invalid,
    );
    await this.panels.rejectCyclicPanels(branchId, valid, invalid);
    const { processed, created, updated, importErrors, processedCodes } =
      await this.writer.upsertStudies(branchId, valid, existingByCode);

    const { panelsUpdated, panelErrors } = await this.panels.importPanelItems(
      branchId,
      valid.flatMap((v) =>
        v.panelCodes && processedCodes.has(v.code)
          ? [{ code: v.code, panelCodes: v.panelCodes }]
          : [],
      ),
    );

    return {
      totalRows: rows.length,
      processed,
      created,
      updated,
      panelsUpdated,
      invalid,
      importErrors: importErrors.length > 0 ? importErrors : undefined,
      panelErrors: panelErrors.length > 0 ? panelErrors : undefined,
    };
  }
}
