import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ExcelCellValue } from 'src/common/utils/excel-normalizers';
import { ImportRowError } from 'src/studies/types/importRow';

const PRICE_COLUMNS = ['code', 'name', 'price'];
const REQUIRED_COLUMNS = ['code', 'price'];

type PriceRow = { row: number; code: string; price: number };

const cellToString = (val: ExcelCellValue): string =>
  val === null || val === undefined ? '' : String(val).trim();

/**
 * Bulk load of prices into one price sheet from an Excel file, keyed by study
 * `code`. Only touches `StudyOnPriceSheet`: it never creates or edits studies.
 * `name` is a reference column for whoever fills the file and is ignored.
 */
@Injectable()
export class PriceSheetPriceImportService {
  constructor(private readonly prisma: PrismaService) {}

  generateTemplate(): Buffer {
    const sheet = XLSX.utils.json_to_sheet(
      [{ code: 'BH001', name: 'Biometría Hemática', price: 150 }],
      { header: PRICE_COLUMNS },
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Precios');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async importPrices(
    priceSheet: { id: string; branchId: string },
    buffer: Buffer,
  ) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
      throw new BadRequestException('El archivo de Excel no contiene hojas.');

    const rows = XLSX.utils.sheet_to_json<Record<string, ExcelCellValue>>(
      workbook.Sheets[sheetName],
      { defval: null, raw: false, blankrows: false },
    );
    if (!rows.length)
      throw new BadRequestException('El Excel no contiene filas de datos');

    const headerKeys = new Set(rows.flatMap((row) => Object.keys(row)));
    const missingHeaders = REQUIRED_COLUMNS.filter((h) => !headerKeys.has(h));
    if (missingHeaders.length) {
      throw new BadRequestException(
        `El archivo debe contener las columnas: ${missingHeaders.map((h) => `'${h}'`).join(', ')}.`,
      );
    }

    const candidates: PriceRow[] = [];
    const invalid: ImportRowError[] = [];
    const seenCodes = new Set<string>();
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = i + 2;
      const code = cellToString(rows[i].code).toUpperCase();
      const rawPrice = cellToString(rows[i].price);

      if (!code && !rawPrice) continue;

      const errors: string[] = [];
      if (!code) errors.push('Falta el código del estudio');
      if (code && seenCodes.has(code)) {
        errors.push(`El código '${code}' está duplicado en el archivo`);
      }
      if (code) seenCodes.add(code);

      if (!rawPrice) {
        if (!errors.length) skipped++;
        else invalid.push({ row, code: code || undefined, errors });
        continue;
      }

      const cleanedPrice = rawPrice.replace(/[$,\s]/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(cleanedPrice)) {
        errors.push(`El precio '${rawPrice}' no es un número válido`);
      } else if (cleanedPrice.startsWith('-')) {
        errors.push('El precio no puede ser negativo');
      } else if (/\.\d{3,}$/.test(cleanedPrice)) {
        errors.push('El precio admite máximo 2 decimales');
      }

      if (errors.length) invalid.push({ row, code: code || undefined, errors });
      else candidates.push({ row, code, price: Number(cleanedPrice) });
    }

    const studies = await this.prisma.study.findMany({
      where: {
        branchId: priceSheet.branchId,
        code: { in: candidates.map((c) => c.code) },
      },
      select: { id: true, code: true, isActive: true },
    });
    const studyByCode = new Map(studies.map((s) => [s.code, s]));

    const valid: Array<PriceRow & { studyId: string }> = [];
    for (const item of candidates) {
      const study = studyByCode.get(item.code);
      if (!study) {
        invalid.push({
          row: item.row,
          code: item.code,
          errors: [`El estudio '${item.code}' no existe en esta sucursal`],
        });
      } else if (!study.isActive) {
        invalid.push({
          row: item.row,
          code: item.code,
          errors: [`El estudio '${item.code}' está inactivo`],
        });
      } else {
        valid.push({ ...item, studyId: study.id });
      }
    }
    invalid.sort((a, b) => a.row - b.row);

    const pricedStudyIds = new Set(
      (
        await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: priceSheet.id,
            studyId: { in: valid.map((v) => v.studyId) },
          },
          select: { studyId: true },
        })
      ).map((s) => s.studyId),
    );

    await this.prisma.$transaction(
      valid.map(({ studyId, price }) =>
        this.prisma.studyOnPriceSheet.upsert({
          where: {
            studyId_priceSheetId: { studyId, priceSheetId: priceSheet.id },
          },
          update: { price: new Prisma.Decimal(price) },
          create: {
            studyId,
            priceSheetId: priceSheet.id,
            price: new Prisma.Decimal(price),
          },
        }),
      ),
    );

    const updated = valid.filter((v) => pricedStudyIds.has(v.studyId)).length;

    return {
      totalRows: rows.length,
      created: valid.length - updated,
      updated,
      skipped,
      invalid,
    };
  }
}
