import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import {
  ExcelCellValue,
  toOptionalBool,
} from 'src/common/utils/excel-normalizers';
import {
  STUDY_CATALOG_NAME_MAX_LENGTH,
  StudyCatalogKind,
} from './study-catalog.config';
import {
  catalogNameKey,
  studyCatalogDelegate,
} from './utils/study-catalog.util';

type CatalogSheet = {
  kind: StudyCatalogKind;
  /** Sheet name used in the template. */
  title: string;
  example: string;
  /** Accepted sheet names, compared without accents/case/spaces. */
  aliases: string[];
};

const CATALOG_SHEETS: CatalogSheet[] = [
  {
    kind: 'section',
    title: 'Secciones',
    example: 'Hematología',
    aliases: ['secciones', 'seccion', 'section', 'sections'],
  },
  {
    kind: 'sampleType',
    title: 'Tipos de muestra',
    example: 'Sangre venosa',
    aliases: [
      'tiposdemuestra',
      'tipodemuestra',
      'muestras',
      'sampletype',
      'sampletypes',
    ],
  },
  {
    kind: 'technique',
    title: 'Técnicas',
    example: 'Citometría de flujo',
    aliases: ['tecnicas', 'tecnica', 'technique', 'techniques'],
  },
];

const normalizeSheetName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();

export type CatalogRowError = { row: number; name?: string; errors: string[] };

export type CatalogImportResult = {
  /** false when the file has no sheet for this catalog. */
  found: boolean;
  totalRows: number;
  created: number;
  /** Names that already exist in the branch (case-insensitive): left untouched. */
  skipped: Array<{ row: number; name: string }>;
  invalid: CatalogRowError[];
};

/**
 * Bulk creation of a branch's study catalogs (sections, sample types and
 * techniques) from one Excel with a sheet per catalog. It only creates:
 * existing names are reported as skipped and never updated.
 */
@Injectable()
export class StudyCatalogImportService {
  constructor(private readonly prisma: PrismaService) {}

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

  generateTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    for (const sheet of CATALOG_SHEETS) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet([{ name: sheet.example, isActive: 'true' }], {
          header: ['name', 'isActive'],
        }),
        sheet.title,
      );
    }
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async importCatalogs(branchId: string, buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const sheetNameByKind = new Map<StudyCatalogKind, string>();
    const ignoredSheets: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const normalized = normalizeSheetName(sheetName);
      const catalog = CATALOG_SHEETS.find((c) =>
        c.aliases.includes(normalized),
      );
      if (!catalog || sheetNameByKind.has(catalog.kind)) {
        ignoredSheets.push(sheetName);
      } else {
        sheetNameByKind.set(catalog.kind, sheetName);
      }
    }

    if (!sheetNameByKind.size) {
      throw new BadRequestException(
        `El archivo debe contener al menos una hoja llamada: ${CATALOG_SHEETS.map((c) => `'${c.title}'`).join(', ')}.`,
      );
    }

    const rowsByKind = new Map<
      StudyCatalogKind,
      Record<string, ExcelCellValue>[]
    >();
    for (const [kind, sheetName] of sheetNameByKind) {
      const rows = XLSX.utils.sheet_to_json<Record<string, ExcelCellValue>>(
        workbook.Sheets[sheetName],
        { defval: null, raw: false, blankrows: false },
      );
      if (rows.length && !rows.some((row) => 'name' in row)) {
        throw new BadRequestException(
          `La hoja '${sheetName}' debe contener la columna 'name'.`,
        );
      }
      rowsByKind.set(kind, rows);
    }

    const results = {} as Record<StudyCatalogKind, CatalogImportResult>;
    for (const { kind } of CATALOG_SHEETS) {
      const rows = rowsByKind.get(kind);
      results[kind] = rows
        ? await this.importSheet(kind, branchId, rows)
        : { found: false, totalRows: 0, created: 0, skipped: [], invalid: [] };
    }

    return { ...results, ignoredSheets };
  }

  private async importSheet(
    kind: StudyCatalogKind,
    branchId: string,
    rows: Record<string, ExcelCellValue>[],
  ): Promise<CatalogImportResult> {
    const delegate = studyCatalogDelegate(this.prisma, kind);
    const existingKeys = new Set(
      (
        await delegate.findMany({
          where: { branchId },
          select: { name: true },
        })
      ).map((row) => catalogNameKey(row.name)),
    );

    const toCreate: Array<{
      name: string;
      branchId: string;
      isActive: boolean;
    }> = [];
    const skipped: CatalogImportResult['skipped'] = [];
    const invalid: CatalogRowError[] = [];
    const rowByKey = new Map<string, number>();

    rows.forEach((row, i) => {
      const rowNumber = i + 2;
      const name =
        row.name === null || row.name === undefined
          ? ''
          : String(row.name).trim().replace(/\s+/g, ' ');
      const isActive = toOptionalBool(row.isActive);

      if (!name && isActive === undefined) return;

      const errors: string[] = [];
      if (!name) errors.push('name es obligatorio');
      if (name.length > STUDY_CATALOG_NAME_MAX_LENGTH) {
        errors.push(
          `name no puede tener más de ${STUDY_CATALOG_NAME_MAX_LENGTH} caracteres`,
        );
      }
      if (isActive !== undefined && typeof isActive !== 'boolean') {
        errors.push('isActive debe ser true/false, 1/0 o si/no');
      }

      const key = catalogNameKey(name);
      const firstRow = rowByKey.get(key);
      if (name && firstRow !== undefined) {
        errors.push(`"${name}" está repetido en la hoja (fila ${firstRow})`);
      }

      if (errors.length) {
        invalid.push({ row: rowNumber, ...(name && { name }), errors });
        return;
      }
      rowByKey.set(key, rowNumber);

      if (existingKeys.has(key)) {
        skipped.push({ row: rowNumber, name });
        return;
      }
      toCreate.push({ name, branchId, isActive: isActive ?? true });
    });

    const { count } = toCreate.length
      ? await delegate.createMany({ data: toCreate, skipDuplicates: true })
      : { count: 0 };

    return {
      found: true,
      totalRows: rows.length,
      created: count,
      skipped,
      invalid,
    };
  }
}
