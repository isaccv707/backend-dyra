import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePriceSheetDto } from './dto/create-price-sheet.dto';
import { UpdatePriceSheetDto } from './dto/update-price-sheet.dto';
import { ImportStudyRowDto } from './dto/import-study-row.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPriceSheetDto } from './dto/pagination-price-sheet.dto';
import { FindPriceSheetsDto } from './dto/find-price-sheets.dto';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import { generateSlug } from 'src/common/utils/slugger.util';
import {
  toOptionalBool,
  toOptionalInt,
  toRequiredNumber,
} from 'src/common/utils/excel-normalizers';

const STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS = [
  'study.name',
  'study.code',
  'price',
  'showPrice',
];
const PRICE_SHEET_ALLOWED_FIELDS = [
  'name',
  'description',
  'isActive',
  'isPublic',
  'branch.name',
];

@Injectable()
export class PriceSheetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createPriceSheetDto: CreatePriceSheetDto) {
    const { branchId, isPublic, ...rest } = createPriceSheetDto;

    try {
      return await this.prisma.priceSheets.create({
        data: {
          ...rest,
          isPublic: !!isPublic,
          branch: { connect: { id: branchId } },
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  async findAll(dto: FindPriceSheetsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'description', 'branch.name'],
      defaultSort: { name: 'asc' },
      allowedFields: PRICE_SHEET_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
    } as Prisma.PriceSheetsWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.priceSheets.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: {
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.priceSheets.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(
    id: string,
    dto: PaginationPriceSheetDto,
    user: BranchScopedUser,
  ) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['study.name', 'study.code'],
      defaultSort: { study: { name: 'asc' } },
      allowedFields: STUDY_ON_PRICE_SHEET_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      priceSheetId: id,
    } as Prisma.StudyOnPriceSheetWhereInput;

    const [priceSheet, total] = await Promise.all([
      this.prisma.priceSheets.findUnique({
        where: { id },
        include: {
          studyOnPriceSheets: {
            where: finalWhere,
            skip,
            take,
            orderBy,
            include: {
              study: true,
            },
          },
        },
      }),
      this.prisma.studyOnPriceSheet.count({
        where: finalWhere,
      }),
    ]);

    if (!priceSheet) {
      throw new NotFoundException(`PriceSheet with id ${id} not found`);
    }

    assertBranchAccess(user, priceSheet.branchId);

    return {
      ...priceSheet,
      studyOnPriceSheets: paginatedResponse(
        priceSheet.studyOnPriceSheets,
        total,
        dto.page ?? 1,
        dto.limit ?? 10,
      ),
    };
  }

  async update(id: string, updatePriceSheetDto: UpdatePriceSheetDto) {
    const { branchId, isPublic, ...rest } = updatePriceSheetDto;

    try {
      return await this.prisma.priceSheets.update({
        where: { id },
        data: {
          ...rest,
          ...(isPublic !== undefined && { isPublic }),
          ...(branchId && { branch: { connect: { id: branchId } } }),
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.priceSheets.delete({
        where: { id },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'PriceSheet');
    }
  }

  private async getPriceSheetOrThrow(id: string, user: BranchScopedUser) {
    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id },
    });
    if (!priceSheet) {
      throw new NotFoundException(`PriceSheet with id ${id} not found`);
    }
    assertBranchAccess(user, priceSheet.branchId);
    return priceSheet;
  }

  async generateImportTemplate(
    id: string,
    user: BranchScopedUser,
  ): Promise<Buffer> {
    const priceSheet = await this.getPriceSheetOrThrow(id, user);

    const services = await this.prisma.service.findMany({
      where: { branchId: priceSheet.branchId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const headers = [
      'code',
      'name',
      'description',
      'sampleType',
      'preparation',
      'serviceName',
      'deliveryTime',
      'isActive',
      'price',
      'showPrice',
    ];

    const exampleRow: Record<string, string | number> = {
      code: 'BH001',
      name: 'Biometría Hemática',
      description: 'Conteo completo de células sanguíneas',
      sampleType: 'Sangre venosa',
      preparation: 'Ayuno de 8 horas',
      serviceName: services[0]?.name ?? 'PEGAR-AQUI-EL-NOMBRE-DEL-SERVICIO',
      deliveryTime: 1,
      isActive: 'true',
      price: 150,
      showPrice: 'true',
    };

    const studiesSheet = XLSX.utils.json_to_sheet([exampleRow], { header: headers });

    const servicesSheet = XLSX.utils.json_to_sheet(
      services.map((s) => ({ name: s.name })),
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, studiesSheet, 'Estudios');
    XLSX.utils.book_append_sheet(
      workbook,
      servicesSheet,
      'Servicios (referencia)',
    );

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async importStudiesFromExcel(id: string, buffer: Buffer, user: BranchScopedUser) {
    const priceSheet = await this.getPriceSheetOrThrow(id, user);
    const branchId = priceSheet.branchId;

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
      throw new BadRequestException('El archivo de Excel no contiene hojas.');

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: null,
      raw: false,
      blankrows: false,
    });

    if (!rows.length)
      throw new BadRequestException('El Excel no contiene filas de datos');

    const headerKeys = new Set(rows.flatMap((row) => Object.keys(row)));
    if (!headerKeys.has('price') || !headerKeys.has('serviceName')) {
      throw new BadRequestException(
        "El archivo debe contener las columnas 'price' y 'serviceName'.",
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

    const getPriceValue = (val: any): number => {
      if (val === null || val === undefined) return 0;
      const cleaned = val.toString().trim();
      return cleaned === '' ? 0 : Number(cleaned);
    };

    type ValidRow = {
      code: string;
      name: string;
      slug: string;
      description?: string;
      sampleType?: string;
      preparation?: string;
      deliveryTime?: number;
      isActive?: boolean;
      price: number;
      showPrice?: boolean;
      serviceId: string;
    };

    const valid: ValidRow[] = [];
    const invalid: Array<{ row: number; code?: string; errors: string[] }> = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;
      const row = rows[i];

      const code = row.code?.toString()?.trim();
      const name = row.name?.toString()?.trim();

      if (!name && !code) continue;

      const rowErrors: string[] = [];

      if (code) {
        if (seenCodes.has(code)) {
          rowErrors.push(`El código '${code}' está duplicado en el archivo`);
        }
        seenCodes.add(code);
      }

      const serviceName = row.serviceName?.toString()?.trim();
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
        description: row.description?.toString()?.trim(),
        sampleType: row.sampleType?.toString()?.trim(),
        preparation: row.preparation?.toString()?.trim(),
        serviceName,
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        price: toRequiredNumber(getPriceValue(row.price)),
        showPrice: toOptionalBool(row.showPrice) ?? true,
      };

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
          code: dto.code,
          name: dto.name,
          slug: generateSlug(dto.name),
          description: dto.description,
          sampleType: dto.sampleType,
          preparation: dto.preparation,
          deliveryTime: dto.deliveryTime,
          isActive: dto.isActive,
          price: dto.price,
          showPrice: dto.showPrice,
          serviceId,
        });
      }
    }

    let processed = 0;
    const importErrors: Array<{ code: string; error: string }> = [];

    for (const item of valid) {
      try {
        const study = await this.prisma.study.upsert({
          where: { branchId_code: { branchId, code: item.code } },
          update: {
            name: item.name,
            slug: item.slug,
            description: item.description,
            sampleType: item.sampleType,
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive,
            service: { connect: { id: item.serviceId } },
          },
          create: {
            name: item.name,
            slug: item.slug,
            code: item.code,
            description: item.description,
            sampleType: item.sampleType,
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive ?? true,
            service: { connect: { id: item.serviceId } },
            branch: { connect: { id: branchId } },
          },
        });

        await this.prisma.studyOnPriceSheet.upsert({
          where: {
            studyId_priceSheetId: { studyId: study.id, priceSheetId: id },
          },
          update: {
            price: new Prisma.Decimal(item.price),
            showPrice: item.showPrice ?? true,
          },
          create: {
            studyId: study.id,
            priceSheetId: id,
            price: new Prisma.Decimal(item.price),
            showPrice: item.showPrice ?? true,
          },
        });

        processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        importErrors.push({ code: item.code, error: message });
      }
    }

    return {
      totalRows: rows.length,
      processed,
      invalid,
      importErrors: importErrors.length > 0 ? importErrors : undefined,
    };
  }
}
