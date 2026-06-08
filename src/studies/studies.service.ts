import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { plainToInstance } from 'class-transformer';
import {
  toOptionalBool,
  toOptionalInt,
  toRequiredNumber,
} from './utils/excel-normalizers';
import { v4 as uuid } from 'uuid';
import * as XLSX from 'xlsx';
import { validate } from 'class-validator';
import { PaginationDto } from './dto/pagination-study.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createStudyDto: CreateStudyDto) {
    const { name, studyPrices, serviceId, ...studyData } = createStudyDto;
    const slug = generateSlug(name);

    try {
      return await this.prisma.study.create({
        data: {
          ...studyData,
          service: {
            connect: { id: serviceId },
          },
          name,
          slug,
          priceSheets: {
            create: studyPrices.map((p) => ({
              price: new Prisma.Decimal(p.price),
              showPrice: p.showPrice ?? true,
              priceSheetId: p.priceSheetId,
            })),
          },
        },
        include: {
          service: {
            select: { name: true, slug: true },
          },
          priceSheets: true,
        },
      });
    } catch (error: any) {
      console.log(error);
      handleDatabaseErrors(error, 'Study');
    }
  }

  async findAll({ limit = 10, page = 1, search, priceSheetId }: PaginationDto) {
    const skip = (page - 1) * limit;
    const term = search?.trim().replace(/\s+/g, ' ');
    const MIN_SEARCH_LEN = 2;
    const effectiveTerm =
      term && term.length >= MIN_SEARCH_LEN ? term : undefined;
    const where: Prisma.StudyWhereInput | undefined = term
      ? {
          OR: [
            {
              name: {
                contains: effectiveTerm,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              code: {
                contains: effectiveTerm,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : undefined;

    const selectedPriceSheetId = priceSheetId || 'jalisco-sheet-id';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take: limit,
        where,
        orderBy: { name: 'asc' },
        include: {
          priceSheets: {
            where: { priceSheetId: selectedPriceSheetId },
          },
        },
      }),
      this.prisma.study.count({ where }),
    ]);

    return {
      items: items.map((study) => {
        const regionalPrice = study.priceSheets[0]; // El precio filtrado por selectedPriceSheetId

        return {
          ...study,
          priceInfo: {
            showPrice: regionalPrice?.showPrice ?? false,
            price: regionalPrice?.showPrice ? regionalPrice.price : null,
            message: regionalPrice?.showPrice
              ? null
              : 'Para mayor información consulte en sucursal',
            // Agregamos esto para debug o por si el estado no tiene precio cargado
            hasConfiguredPrice: !!regionalPrice,
          },
          // Quitamos el arreglo original para limpiar la respuesta
          priceSheets: undefined,
        };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const study = await this.prisma.study.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
      },
      include: {
        priceSheets: {
          include: {
            priceSheet: true,
          },
        },
        service: true,
      },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    return study;
  }

  async importFromExcel(buffer: Buffer) {
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

    const valid: (CreateStudyDto & { slug: string })[] = [];
    const invalid: Array<{ row: number; code?: string; errors: string[] }> = [];

    // --- PRE-PROCESAMIENTO Y VALIDACIÓN ---
    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;
      const row = rows[i];

      // Normalización de datos con lógica de negocio
      const normalizedData = {
        name: row.name?.toString()?.trim(),
        code: row.code?.toString()?.trim(),
        description: row.description?.toString()?.trim(),
        sampleType: row.sampleType?.toString()?.trim(),
        preparation: row.preparation?.toString()?.trim(),
        serviceId: row.serviceId?.toString()?.trim(), // AHORA OBLIGATORIO
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        studyPrices: [
          {
            priceSheetId: '1a33374b-41bd-4074-a9b3-4bab047b3486', // JALISCO (Guadalajara)
            price: toRequiredNumber(row.price_jalisco ?? row.price), // Soporta columna específica o general
            showPrice: true,
          },
          {
            priceSheetId: 'eff8ccbb-1db3-445f-803a-201df806971f', // COLIMA
            price: toRequiredNumber(row.price_colima ?? 0),
            showPrice: toOptionalBool(row.show_price_colima) ?? false, // Por defecto oculto en Colima
          },
        ],
      };
      const dto = plainToInstance(CreateStudyDto, normalizedData);
      const errors = await validate(dto, { whitelist: true });
      if (errors.length || !normalizedData.serviceId) {
        invalid.push({
          row: initialRow,
          code: normalizedData.code,
          errors: [
            ...errors.flatMap((e) => Object.values(e.constraints ?? {})),
            ...(!normalizedData.serviceId
              ? ['El serviceId es obligatorio']
              : []),
          ],
        });
      } else {
        valid.push({ ...dto, slug: generateSlug(dto.name) });
      }
    }

    // --- PROCESAMIENTO EN BASE DE DATOS ---
    let processed = 0;
    const importErrors: Array<{ code: string; error: string }> = [];

    await this.prisma.$transaction(
      async (tx) => {
        for (const item of valid) {
          try {
            const { studyPrices, serviceId, ...studyData } = item;

            // Upsert de Study
            await tx.study.upsert({
              where: { code: item.code },
              update: {
                ...studyData,
                service: { connect: { id: serviceId } },
                priceSheets: {
                  // Borramos y recreamos para asegurar que solo queden los estados definidos
                  deleteMany: {},
                  create: studyPrices.map((p) => ({
                    price: new Prisma.Decimal(p.price),
                    priceSheetId: p.priceSheetId,
                    showPrice: p.showPrice,
                  })),
                },
              },
              create: {
                ...studyData,
                service: { connect: { id: serviceId } },
                priceSheets: {
                  create: studyPrices.map((p) => ({
                    price: new Prisma.Decimal(p.price),
                    priceSheetId: p.priceSheetId,
                    showPrice: p.showPrice,
                  })),
                },
              },
            });

            processed++;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            importErrors.push({ code: item.code, error: message });
            // Opcional: lanzar error para hacer rollback total o continuar
            throw error;
          }
        }
      },
      { timeout: 30000 },
    ); // 30s suele ser suficiente para lotes medianos

    return {
      totalRows: rows.length,
      processed,
      invalid,
      importErrors: importErrors.length > 0 ? importErrors : undefined,
    };
  }
}
