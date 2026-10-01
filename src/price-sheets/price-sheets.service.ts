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
  ExcelCellValue,
  toOptionalBool,
  toOptionalInt,
  toRequiredNumber,
} from 'src/common/utils/excel-normalizers';
import {
  normalizeAgeFormat,
  normalizeGender,
} from 'src/studies/constants/study-fields.const';
import {
  findPanelsInCycle,
  loadPanelGraph,
} from 'src/studies/utils/panel-tree.util';
import {
  catalogNameKey,
  resolveStudyCatalogIds,
} from 'src/study-catalogs/utils/study-catalog.util';

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
      'abbreviation',
      'title',
      'section',
      'technique',
      'isPanel',
      'parametros',
      'isOrderable',
      'gender',
      'ageFormat',
      'minAge',
      'maxAge',
      'decimals',
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
      abbreviation: 'BH',
      title: 'Biometría Hemática Completa',
      section: 'Hematología',
      technique: 'Citometría de flujo',
      isPanel: 'false',
      // Solo con isPanel = true: códigos de los estudios hijos separados por coma
      parametros: '',
      isOrderable: 'true',
      gender: 'A',
      ageFormat: 'AÑOS',
      minAge: 0,
      maxAge: 120,
      decimals: 2,
    };

    const studiesSheet = XLSX.utils.json_to_sheet([exampleRow], {
      header: headers,
    });

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

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async importStudiesFromExcel(
    id: string,
    buffer: Buffer,
    user: BranchScopedUser,
  ) {
    const priceSheet = await this.getPriceSheetOrThrow(id, user);
    const branchId = priceSheet.branchId;

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

    const getPriceValue = (val: ExcelCellValue): number => {
      if (val === null || val === undefined) return 0;
      const cleaned = String(val).trim();
      return cleaned === '' ? 0 : Number(cleaned);
    };

    const cellToString = (val: ExcelCellValue): string | undefined =>
      val === null || val === undefined ? undefined : String(val).trim();

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
      abbreviation?: string;
      title?: string;
      section?: string;
      technique?: string;
      isPanel?: boolean;
      isOrderable?: boolean;
      panelCodes?: string[];
      gender?: string;
      ageFormat?: string;
      minAge?: number;
      maxAge?: number;
      decimals?: number;
    };

    const valid: ValidRow[] = [];
    const invalid: Array<{ row: number; code?: string; errors: string[] }> = [];
    const seenCodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const initialRow = i + 2;
      const row = rows[i];

      const code = cellToString(row.code);
      const name = cellToString(row.name);

      if (!name && !code) continue;

      const rowErrors: string[] = [];

      if (code) {
        if (seenCodes.has(code)) {
          rowErrors.push(`El código '${code}' está duplicado en el archivo`);
        }
        seenCodes.add(code);
      }

      // Códigos de los hijos del perfil; se resuelven después de importar
      // todas las filas para que un perfil pueda referir estudios del mismo
      // archivo.
      const panelCodes = (cellToString(row.parametros) ?? '')
        .split(',')
        .map((c) => c.trim())
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
        description: cellToString(row.description),
        sampleType: cellToString(row.sampleType),
        preparation: cellToString(row.preparation),
        serviceName,
        deliveryTime: toOptionalInt(row.deliveryTime),
        isActive: toOptionalBool(row.isActive) ?? true,
        price: toRequiredNumber(getPriceValue(row.price)),
        showPrice: toOptionalBool(row.showPrice) ?? true,
        abbreviation: cellToString(row.abbreviation),
        title: cellToString(row.title),
        section: cellToString(row.section),
        technique: cellToString(row.technique),
        isPanel: rowIsPanel,
        isOrderable: toOptionalBool(row.isOrderable),
        gender: normalizeGender(cellToString(row.gender)),
        ageFormat: normalizeAgeFormat(cellToString(row.ageFormat)),
        minAge: toOptionalInt(row.minAge),
        maxAge: toOptionalInt(row.maxAge),
        decimals: toOptionalInt(row.decimals),
      };

      // minAge/maxAge van juntos: con solo uno no se puede validar el rango
      // contra el valor ya guardado (o el default) sin consultar cada fila.
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
          abbreviation: dto.abbreviation,
          title: dto.title,
          section: dto.section || undefined,
          technique: dto.technique,
          isPanel: dto.isPanel,
          isOrderable: dto.isOrderable,
          panelCodes: panelCodes.length ? panelCodes : undefined,
          gender: dto.gender,
          ageFormat: dto.ageFormat,
          minAge: dto.minAge,
          maxAge: dto.maxAge,
          decimals: dto.decimals,
        });
      }
    }

    let processed = 0;
    const importErrors: Array<{ code: string; error: string }> = [];
    const processedCodes = new Set<string>();

    // Un perfil con hijos no se puede desmarcar (isPanel = false) hasta
    // quitarle todos sus estudios.
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

    // Sección, tipo de muestra y técnica llegan como nombre: se resuelven en
    // el catálogo de la sucursal y los que no existen se dan de alta.
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
        const study = await this.prisma.study.upsert({
          where: { branchId_code: { branchId, code: item.code } },
          update: {
            name: item.name,
            slug: item.slug,
            description: item.description,
            sampleType: connectCatalog(sampleTypeIds, item.sampleType),
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive,
            abbreviation: item.abbreviation,
            title: item.title,
            section: connectCatalog(sectionIds, item.section),
            technique: connectCatalog(techniqueIds, item.technique),
            isPanel: item.isPanel,
            isOrderable: item.isOrderable,
            gender: item.gender,
            ageFormat: item.ageFormat,
            minAge: item.minAge,
            maxAge: item.maxAge,
            decimals: item.decimals,
            service: { connect: { id: item.serviceId } },
          },
          create: {
            name: item.name,
            slug: item.slug,
            code: item.code,
            description: item.description,
            sampleType: connectCatalog(sampleTypeIds, item.sampleType),
            preparation: item.preparation,
            deliveryTime: item.deliveryTime,
            isActive: item.isActive ?? true,
            abbreviation: item.abbreviation,
            title: item.title,
            section: connectCatalog(sectionIds, item.section),
            technique: connectCatalog(techniqueIds, item.technique),
            isPanel: item.isPanel,
            isOrderable: item.isOrderable,
            gender: item.gender,
            ageFormat: item.ageFormat,
            minAge: item.minAge,
            maxAge: item.maxAge,
            decimals: item.decimals,
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
        processedCodes.add(item.code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        importErrors.push({ code: item.code, error: message });
      }
    }

    const { panelsUpdated, panelErrors } = await this.importPanelItems(
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
      panelsUpdated,
      invalid,
      importErrors: importErrors.length > 0 ? importErrors : undefined,
      panelErrors: panelErrors.length > 0 ? panelErrors : undefined,
    };
  }

  // Reemplaza los hijos de cada perfil importado. Se valida contra el grafo
  // completo de la sucursal (con todos los cambios del archivo aplicados) para
  // rechazar ciclos entre perfiles, incluso si están en filas distintas.
  private async importPanelItems(
    branchId: string,
    panelRows: Array<{ code: string; panelCodes: string[] }>,
  ) {
    const panelErrors: Array<{ code: string; error: string }> = [];
    if (!panelRows.length) return { panelsUpdated: 0, panelErrors };

    const neededCodes = new Set(
      panelRows.flatMap((r) => [r.code, ...r.panelCodes]),
    );
    const studies = await this.prisma.study.findMany({
      where: { branchId, code: { in: [...neededCodes] } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(studies.map((s) => [s.code, s.id]));

    const graph = await loadPanelGraph(this.prisma, branchId);
    const pending = new Map<string, { code: string; childIds: string[] }>();

    for (const row of panelRows) {
      const missing = row.panelCodes.filter((c) => !idByCode.has(c));
      if (missing.length) {
        panelErrors.push({
          code: row.code,
          error: `Parámetros no encontrados en la sucursal: ${missing.join(', ')}`,
        });
        continue;
      }
      const panelId = idByCode.get(row.code)!;
      const childIds = row.panelCodes.map((c) => idByCode.get(c)!);
      graph.set(panelId, childIds);
      pending.set(panelId, { code: row.code, childIds });
    }

    const cyclic = new Set(findPanelsInCycle(graph, pending.keys()));
    let panelsUpdated = 0;

    for (const [panelId, { code, childIds }] of pending) {
      if (cyclic.has(panelId)) {
        panelErrors.push({
          code,
          error:
            'Los parámetros forman un ciclo: algún perfil hijo contiene (directa o indirectamente) a este perfil',
        });
        continue;
      }

      try {
        await this.prisma.$transaction([
          this.prisma.studyPanelItem.deleteMany({ where: { panelId } }),
          this.prisma.studyPanelItem.createMany({
            data: childIds.map((childId, order) => ({
              panelId,
              childId,
              order,
            })),
          }),
        ]);
        panelsUpdated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        panelErrors.push({ code, error: message });
      }
    }

    return { panelsUpdated, panelErrors };
  }
}
