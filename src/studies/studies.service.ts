import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto, StudyPriceDto } from './dto/create-study.dto';
import { plainToInstance } from 'class-transformer';
import {
  toOptionalBool,
  toOptionalInt,
  toRequiredNumber,
} from './utils/excel-normalizers';
import * as XLSX from 'xlsx';
import { validate, ValidationError } from 'class-validator';
import { PaginationDto } from './dto/pagination-study.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { BranchesService } from 'src/branches/branches.service';

@Injectable()
export class StudiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
  ) {}

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

  async findAll({
    limit = 10,
    page = 1,
    search,
    priceSheetId,
    branchId,
  }: PaginationDto) {
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

    const selectedPriceSheetId = branchId
      ? ((await this.branchesService.resolveBranchPriceSheetId(branchId)) ?? undefined)
      : priceSheetId;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take: limit,
        where,
        orderBy: { name: 'asc' },
        include: {
          // Sin branchId/priceSheetId no hay sucursal seleccionada: usamos un
          // valor que no puede coincidir para que no se muestre ningún precio.
          priceSheets: {
            where: { priceSheetId: selectedPriceSheetId ?? '' },
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

    // --- HELPERS INTERNOS PARA ROBUSTEZ ---

    /**
     * Extrae recursivamente los mensajes de error de class-validator,
     * permitiendo visualizar fallos en DTOs anidados (ej. studyPrices).
     */
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

    /**
     * Limpia y evalúa valores numéricos del Excel.
     * Previene que strings vacíos o espacios devuelvan NaN en helpers.
     */
    const getPriceValue = (val: any): number => {
      if (val === null || val === undefined) return 0;
      const cleaned = val.toString().trim();
      return cleaned === '' ? 0 : Number(cleaned);
    };

    // --- PRE-PROCESAMIENTO Y VALIDACIÓN ---
    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;
      const row = rows[i];

      const name = row.name?.toString()?.trim();
      const code = row.code?.toString()?.trim();

      // 3. PREVENCIÓN DE FILAS FANTASMA
      if (!name && !code) continue;

      // 1. ROBUSTEZ EN PRECIOS (Filtrado de valores no positivos para DTO)
      const studyPrices: StudyPriceDto[] = [];

      // Jalisco (Principal) - Soporta columna específica o general
      const jaliscoRaw = row.price_jalisco ?? row.price;
      studyPrices.push({
        priceSheetId: '1a33374b-41bd-4074-a9b3-4bab047b3486',
        price: toRequiredNumber(getPriceValue(jaliscoRaw)),
        showPrice: true,
      });

      // Colima (Secundaria) - Solo se agrega si el precio es > 0 para cumplir @IsPositive()
      const colimaPrice = getPriceValue(row.price_colima);
      if (colimaPrice > 0) {
        studyPrices.push({
          priceSheetId: 'eff8ccbb-1db3-445f-803a-201df806971f',
          price: toRequiredNumber(colimaPrice),
          showPrice: toOptionalBool(row.show_price_colima) ?? false,
        });
      }

      // Normalización de datos con lógica de negocio
      const normalizedData = {
        name,
        code,
        description: row.description?.toString()?.trim(),
        sampleType: row.sampleType?.toString()?.trim(),
        preparation: row.preparation?.toString()?.trim(),
        serviceId: row.serviceId?.toString()?.trim(),
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        studyPrices,
      };

      const dto = plainToInstance(CreateStudyDto, normalizedData);
      const errors = await validate(dto, { whitelist: true });

      if (errors.length || !normalizedData.serviceId) {
        invalid.push({
          row: initialRow,
          code: normalizedData.code,
          errors: [
            ...extractErrors(errors), // 2. EXTRACCIÓN RECURSIVA
            ...(!normalizedData.serviceId
              ? ['El serviceId es obligatorio']
              : []),
          ],
        });
      } else {
        valid.push({ ...dto, slug: generateSlug(dto.name) });
      }
    }

    // --- PROCESAMIENTO EN BASE DE DATOS (CHUNKS PARA DATOS MASIVOS) ---
    let processed = 0;
    const importErrors: Array<{ code: string; error: string }> = [];
    const BATCH_SIZE = 100; // Tamaño de lote para equilibrar velocidad y estabilidad

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const chunk = valid.slice(i, i + BATCH_SIZE);

      try {
        await this.prisma.$transaction(
          async (tx) => {
            for (const item of chunk) {
              const { studyPrices, serviceId, ...studyData } = item;

              // Upsert de Study: Mantiene consistencia por código
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
            }
          },
          { timeout: 60000 }, // Timeout de 60s por lote (ajustado para manejo masivo)
        );
      } catch (error) {
        // En caso de error en un lote, registramos los códigos fallidos y continuamos con el siguiente lote
        const message = error instanceof Error ? error.message : String(error);
        chunk.forEach((item) => {
          importErrors.push({
            code: item.code,
            error: `Error en lote: ${message}`,
          });
        });
        // Opcional: Podrías relanzar si prefieres fallo total, pero para "masivo" es mejor Best Effort
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
