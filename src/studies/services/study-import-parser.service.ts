import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  ExcelCellValue,
  toOptionalBool,
  toOptionalInt,
} from 'src/common/utils/excel-normalizers';
import {
  normalizeAgeFormat,
  normalizeGender,
} from '../constants/study-fields.const';
import { ImportStudyRowDto } from '../dto/import-study-row.dto';
import { ImportRowError, ValidStudyImportRow } from '../types/importRow';

const PRICE_COLUMNS = ['price', 'showPrice'];

/**
 * Reads the file and checks each row on its own (columns, types, service,
 * prices, ages, parametros), before comparing it with the branch's studies.
 */
@Injectable()
export class StudyImportParserService {
  constructor(private readonly prisma: PrismaService) {}

  async parseRows(branchId: string, buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
      throw new BadRequestException('El archivo de Excel no contiene hojas.');

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, ExcelCellValue>>(
      sheet,
      {
        defval: null,
        raw: false,
        blankrows: false,
      },
    );

    if (!rows.length)
      throw new BadRequestException('El Excel no contiene filas de datos');

    const headerKeys = new Set(rows.flatMap((row) => Object.keys(row)));
    const requiredHeaders = ['code', 'name', 'serviceName'];
    const missingHeaders = requiredHeaders.filter((h) => !headerKeys.has(h));
    if (missingHeaders.length) {
      throw new BadRequestException(
        `El archivo debe contener las columnas: ${missingHeaders.map((h) => `'${h}'`).join(', ')}.`,
      );
    }

    const services = await this.prisma.service.findMany({
      where: { branchId },
      select: { id: true, name: true },
    });
    const serviceIdByName = new Map(
      services.map((s) => [s.name.trim().toLowerCase(), s.id]),
    );

    const extractErrors = (errors: ValidationError[]): string[] => {
      const messages: string[] = [];
      for (const error of errors) {
        if (error.constraints) {
          messages.push(...Object.values(error.constraints));
        }
        if (error.children && error.children.length > 0) {
          messages.push(...extractErrors(error.children));
        }
      }
      return messages;
    };

    const cellToString = (val: ExcelCellValue): string | undefined =>
      val === null || val === undefined ? undefined : String(val).trim();

    const valid: ValidStudyImportRow[] = [];
    const invalid: ImportRowError[] = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;
      const row = rows[i];

      const code = cellToString(row.code)?.toUpperCase();
      const name = cellToString(row.name);

      if (!name && !code) continue;

      const rowErrors: string[] = [];

      if (code) {
        if (seenCodes.has(code)) {
          rowErrors.push(`El código '${code}' está duplicado en el archivo`);
        }
        seenCodes.add(code);
      }

      const priceColumns = PRICE_COLUMNS.filter((c) => cellToString(row[c]));
      if (priceColumns.length) {
        rowErrors.push(
          `Esta importación no asigna precios: deja vacía(s) la(s) columna(s) ${priceColumns.join(', ')} o usa la importación del tarifario`,
        );
      }

      const panelCodes = (cellToString(row.parametros) ?? '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      const rowIsPanel = toOptionalBool(row.isPanel);
      if (panelCodes.length) {
        if (rowIsPanel !== true) {
          rowErrors.push(
            'La columna parametros solo aplica a filas con isPanel = true',
          );
        }
        if (new Set(panelCodes).size !== panelCodes.length) {
          rowErrors.push('La columna parametros tiene códigos repetidos');
        }
        if (code && panelCodes.includes(code)) {
          rowErrors.push('Un perfil no puede contenerse a sí mismo');
        }
      }

      const serviceName = cellToString(row.serviceName);
      const serviceId = serviceName
        ? serviceIdByName.get(serviceName.toLowerCase())
        : undefined;
      if (serviceName && !serviceId) {
        rowErrors.push(
          `El servicio "${serviceName}" no existe o no pertenece a esta sucursal`,
        );
      }

      const normalizedData = {
        code,
        name,
        title: cellToString(row.title) || undefined,
        description: cellToString(row.description),
        sampleType: cellToString(row.sampleType),
        preparation: cellToString(row.preparation),
        serviceName,
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        abbreviation: cellToString(row.abbreviation),
        section: cellToString(row.section),
        technique: cellToString(row.technique),
        isPanel: rowIsPanel,
        gender: normalizeGender(cellToString(row.gender)),
        ageFormat: normalizeAgeFormat(cellToString(row.ageFormat)),
        minAge: toOptionalInt(row.minAge),
        maxAge: toOptionalInt(row.maxAge),
        units: cellToString(row.units) || undefined,
        decimals: toOptionalInt(row.decimals),
      };

      const hasMinAge = normalizedData.minAge !== undefined;
      const hasMaxAge = normalizedData.maxAge !== undefined;
      if (hasMinAge !== hasMaxAge) {
        rowErrors.push('minAge y maxAge deben capturarse juntos');
      } else if (
        typeof normalizedData.minAge === 'number' &&
        typeof normalizedData.maxAge === 'number' &&
        normalizedData.minAge > normalizedData.maxAge
      ) {
        rowErrors.push('minAge no puede ser mayor que maxAge');
      }

      const dto = plainToInstance(ImportStudyRowDto, normalizedData);
      const errors = await validate(dto, { whitelist: true });

      if (errors.length || rowErrors.length || !serviceId) {
        invalid.push({
          row: initialRow,
          code,
          errors: [...extractErrors(errors), ...rowErrors],
        });
      } else {
        valid.push({
          row: initialRow,
          code: dto.code,
          name: dto.name,
          title: dto.title,
          description: dto.description,
          sampleType: dto.sampleType,
          preparation: dto.preparation,
          deliveryTime: dto.deliveryTime,
          isActive: dto.isActive,
          serviceId,
          abbreviation: dto.abbreviation,
          section: dto.section || undefined,
          technique: dto.technique,
          isPanel: dto.isPanel,
          panelCodes: panelCodes.length ? panelCodes : undefined,
          gender: dto.gender,
          ageFormat: dto.ageFormat,
          minAge: dto.minAge,
          maxAge: dto.maxAge,
          units: dto.units,
          decimals: dto.decimals,
        });
      }
    }

    return { rows, valid, invalid };
  }
}
