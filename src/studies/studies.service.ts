import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto, StudyPriceDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
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
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const STUDY_ALLOWED_FIELDS = ['name', 'code', 'isActive', 'deliveryTime', 'createdAt'];

@Injectable()
export class StudiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
  ) {}

  private async assertServiceBelongsToBranch(serviceId: string, branchId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { branchId: true },
    });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }
    if (service.branchId !== branchId) {
      throw new BadRequestException(
        'El servicio seleccionado pertenece a otra sucursal',
      );
    }
  }

  private async assertPriceSheetsBelongToBranch(priceSheetIds: string[], branchId: string) {
    if (!priceSheetIds.length) return;

    const priceSheets = await this.prisma.priceSheets.findMany({
      where: { id: { in: priceSheetIds } },
      select: { id: true, branchId: true },
    });

    const foreign = priceSheets.find((ps) => ps.branchId !== branchId);
    if (foreign || priceSheets.length !== priceSheetIds.length) {
      throw new BadRequestException(
        'Todos los tarifarios asignados deben pertenecer a la misma sucursal del estudio',
      );
    }
  }

  async create(createStudyDto: CreateStudyDto) {
    const { name, studyPrices, serviceId, branchId, ...studyData } = createStudyDto;
    const slug = generateSlug(name);

    await this.assertServiceBelongsToBranch(serviceId, branchId);
    if (studyPrices?.length) {
      await this.assertPriceSheetsBelongToBranch(
        studyPrices.map((p) => p.priceSheetId),
        branchId,
      );
    }

    try {
      return await this.prisma.study.create({
        data: {
          ...studyData,
          service: {
            connect: { id: serviceId },
          },
          branch: {
            connect: { id: branchId },
          },
          name,
          slug,
          ...(studyPrices?.length && {
            priceSheets: {
              create: studyPrices.map((p) => ({
                price: new Prisma.Decimal(p.price),
                showPrice: p.showPrice ?? true,
                priceSheetId: p.priceSheetId,
              })),
            },
          }),
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

  async findAll(dto: PaginationDto) {
    const { priceSheetId, branchId } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'code'],
      defaultSort: { name: 'asc' },
      allowedFields: STUDY_ALLOWED_FIELDS,
      minSearchLength: 2,
    });

    const selectedPriceSheetId = branchId
      ? ((await this.branchesService.resolveBranchPriceSheetId(branchId)) ?? undefined)
      : priceSheetId;

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take,
        where: whereClause,
        orderBy,
        include: {
          // Sin branchId/priceSheetId no hay tarifario seleccionado: usamos un
          // valor que no puede coincidir para que no se muestre ningún precio.
          priceSheets: {
            where: { priceSheetId: selectedPriceSheetId ?? '' },
          },
        },
      }),
      this.prisma.study.count({ where: whereClause }),
    ]);

    const data = items.map((study) => {
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
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, branchId?: string) {
    const study = await this.prisma.study.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        ...(branchId && { branchId }),
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

  async update(id: string, updateStudyDto: UpdateStudyDto) {
    const { name, serviceId, branchId, ...studyData } = updateStudyDto;

    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    const effectiveBranchId = branchId ?? existingStudy.branchId;
    const effectiveServiceId = serviceId ?? existingStudy.serviceId;
    if (branchId || serviceId) {
      await this.assertServiceBelongsToBranch(effectiveServiceId, effectiveBranchId);
    }

    try {
      return await this.prisma.study.update({
        where: { id },
        data: {
          ...studyData,
          ...(name && { name, slug: generateSlug(name) }),
          ...(serviceId && { service: { connect: { id: serviceId } } }),
          ...(branchId && { branch: { connect: { id: branchId } } }),
        },
        include: {
          service: {
            select: { name: true, slug: true },
          },
          priceSheets: true,
        },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async assignPriceSheet(studyId: string, dto: AssignPriceSheetDto) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${studyId} not found`);
    }

    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id: dto.priceSheetId },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `PriceSheet with id ${dto.priceSheetId} not found`,
      );
    }
    if (priceSheet.branchId !== study.branchId) {
      throw new BadRequestException(
        'El tarifario pertenece a otra sucursal distinta a la del estudio',
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.upsert({
        where: {
          studyId_priceSheetId: {
            studyId,
            priceSheetId: dto.priceSheetId,
          },
        },
        update: {
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        create: {
          studyId,
          priceSheetId: dto.priceSheetId,
          price: new Prisma.Decimal(dto.price),
          showPrice: dto.showPrice ?? true,
        },
        include: { priceSheet: true },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async removePriceSheet(studyId: string, priceSheetId: string) {
    const assignment = await this.prisma.studyOnPriceSheet.findUnique({
      where: { studyId_priceSheetId: { studyId, priceSheetId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Study ${studyId} has no price assigned for PriceSheet ${priceSheetId}`,
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.delete({
        where: { studyId_priceSheetId: { studyId, priceSheetId } },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
  }

  async remove(id: string) {
    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.studyOnPriceSheet.deleteMany({ where: { studyId: id } });
        return tx.study.delete({ where: { id } });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }
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

    // Los tarifarios activos definen dinámicamente las columnas de precio
    // esperadas (price_<slug-del-tarifario> / show_price_<slug-del-tarifario>),
    // en vez de asumir un par fijo de tarifarios (ej. "jalisco"/"colima").
    const priceSheets = await this.prisma.priceSheets.findMany({
      where: { isActive: true },
    });
    const priceSheetColumns = priceSheets.map((ps) => ({
      id: ps.id,
      branchId: ps.branchId,
      priceKey: `price_${generateSlug(ps.name)}`,
      showKey: `show_price_${generateSlug(ps.name)}`,
    }));

    // Para validar que serviceId pertenezca a la sucursal indicada en cada
    // fila sin hacer una consulta por fila.
    const services = await this.prisma.service.findMany({
      select: { id: true, branchId: true },
    });
    const serviceBranchById = new Map(services.map((s) => [s.id, s.branchId]));

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

      const branchId = row.branchId?.toString()?.trim();

      // 1. ROBUSTEZ EN PRECIOS: se incluye un precio por cada tarifario activo
      // que tenga un valor > 0 en su columna correspondiente del Excel, y que
      // pertenezca a la misma sucursal indicada en la fila.
      const studyPrices: StudyPriceDto[] = [];
      const priceErrors: string[] = [];
      for (const { id, branchId: priceSheetBranchId, priceKey, showKey } of priceSheetColumns) {
        const priceValue = getPriceValue(row[priceKey]);
        if (priceValue <= 0) continue;

        if (branchId && priceSheetBranchId !== branchId) {
          priceErrors.push(
            `La columna ${priceKey} pertenece a un tarifario de otra sucursal distinta a branchId`,
          );
          continue;
        }

        studyPrices.push({
          priceSheetId: id,
          price: toRequiredNumber(priceValue),
          showPrice: toOptionalBool(row[showKey]) ?? true,
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
        branchId,
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        studyPrices,
      };

      const dto = plainToInstance(CreateStudyDto, normalizedData);
      const errors = await validate(dto, { whitelist: true });

      const missingFieldErrors: string[] = [...priceErrors];
      if (!normalizedData.serviceId) {
        missingFieldErrors.push('El serviceId es obligatorio');
      } else if (
        normalizedData.branchId &&
        serviceBranchById.get(normalizedData.serviceId) !== undefined &&
        serviceBranchById.get(normalizedData.serviceId) !== normalizedData.branchId
      ) {
        missingFieldErrors.push('El servicio pertenece a otra sucursal distinta a branchId');
      }
      if (studyPrices.length === 0) {
        missingFieldErrors.push(
          'Debe especificar al menos un precio válido en alguna columna price_<tarifario> de la misma sucursal',
        );
      }

      if (errors.length || missingFieldErrors.length) {
        invalid.push({
          row: initialRow,
          code: normalizedData.code,
          errors: [
            ...extractErrors(errors), // 2. EXTRACCIÓN RECURSIVA
            ...missingFieldErrors,
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
              const { studyPrices, serviceId, branchId, ...studyData } = item;

              // Upsert de Study: Mantiene consistencia por (sucursal, código)
              await tx.study.upsert({
                where: { branchId_code: { branchId, code: item.code } },
                update: {
                  ...studyData,
                  service: { connect: { id: serviceId } },
                  branch: { connect: { id: branchId } },
                  priceSheets: {
                    // Borramos y recreamos para asegurar que solo queden los estados definidos
                    deleteMany: {},
                    create: (studyPrices ?? []).map((p) => ({
                      price: new Prisma.Decimal(p.price),
                      priceSheetId: p.priceSheetId,
                      showPrice: p.showPrice,
                    })),
                  },
                },
                create: {
                  ...studyData,
                  service: { connect: { id: serviceId } },
                  branch: { connect: { id: branchId } },
                  priceSheets: {
                    create: (studyPrices ?? []).map((p) => ({
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

  async generateImportTemplate(): Promise<Buffer> {
    const [priceSheets, services, branches] = await Promise.all([
      this.prisma.priceSheets.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.findMany({
        orderBy: { name: 'asc' },
      }),
    ]);

    const headers = [
      'name',
      'code',
      'description',
      'sampleType',
      'preparation',
      'serviceId',
      'branchId',
      'deliveryTime',
      'isActive',
      ...priceSheets.flatMap((ps) => {
        const key = generateSlug(ps.name);
        return [`price_${key}`, `show_price_${key}`];
      }),
    ];

    const exampleRow: Record<string, string | number> = {
      name: 'Biometría Hemática',
      code: 'BH001',
      description: 'Conteo completo de células sanguíneas',
      sampleType: 'Sangre venosa',
      preparation: 'Ayuno de 8 horas',
      serviceId: services[0]?.id ?? 'PEGAR-AQUI-EL-ID-DEL-SERVICIO',
      branchId: branches[0]?.id ?? 'PEGAR-AQUI-EL-ID-DE-LA-SUCURSAL',
      deliveryTime: 1,
      isActive: 'true',
    };
    for (const ps of priceSheets) {
      const key = generateSlug(ps.name);
      exampleRow[`price_${key}`] = 150;
      exampleRow[`show_price_${key}`] = 'true';
    }

    const studiesSheet = XLSX.utils.json_to_sheet([exampleRow], { header: headers });

    const servicesSheet = XLSX.utils.json_to_sheet(
      services.map((s) => ({ id: s.id, name: s.name, branchId: s.branchId })),
    );

    const branchesSheet = XLSX.utils.json_to_sheet(
      branches.map((b) => ({ id: b.id, name: b.name })),
    );

    const priceSheetsSheet = XLSX.utils.json_to_sheet(
      priceSheets.map((ps) => ({
        id: ps.id,
        name: ps.name,
        branchId: ps.branchId,
        columna_precio: `price_${generateSlug(ps.name)}`,
      })),
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, studiesSheet, 'Estudios');
    XLSX.utils.book_append_sheet(
      workbook,
      servicesSheet,
      'Servicios (referencia)',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      branchesSheet,
      'Sucursales (referencia)',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      priceSheetsSheet,
      'Tarifarios (referencia)',
    );

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}
