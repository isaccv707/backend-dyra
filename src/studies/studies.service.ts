import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
import { PaginationDto } from './dto/pagination-study.dto';
import { SetPanelItemsDto } from './dto/set-panel-items.dto';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { generateSlug } from 'src/common/utils/slugger.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  findPanelsInCycle,
  loadPanelGraph,
  loadPanelTree,
} from './utils/panel-tree.util';
import {
  STUDY_CATALOGS,
  StudyCatalogKind,
} from 'src/study-catalogs/study-catalog.config';
import { studyCatalogDelegate } from 'src/study-catalogs/utils/study-catalog.util';

const STUDY_ALLOWED_FIELDS = [
  'name',
  'code',
  'abbreviation',
  'section.name',
  'sampleType.name',
  'technique.name',
  'isActive',
  'isPanel',
  'isOrderable',
  'gender',
  'ageFormat',
  'deliveryTime',
  'createdAt',
];

// Deben coincidir con los @default de Study.minAge/maxAge en schema.prisma
const DEFAULT_MIN_AGE = 0;
const DEFAULT_MAX_AGE = 120;

const CATALOG_INCLUDE = {
  section: { select: { id: true, name: true } },
  sampleType: { select: { id: true, name: true } },
  technique: { select: { id: true, name: true } },
} satisfies Prisma.StudyInclude;

type StudyCatalogIds = {
  sectionId?: number | null;
  sampleTypeId?: number | null;
  techniqueId?: number | null;
};

const CATALOG_ID_FIELDS: Array<[keyof StudyCatalogIds, StudyCatalogKind]> = [
  ['sectionId', 'section'],
  ['sampleTypeId', 'sampleType'],
  ['techniqueId', 'technique'],
];

// id -> connect, null -> disconnect (solo update), undefined -> sin cambio
function catalogRelations(ids: StudyCatalogIds, mode: 'create' | 'update') {
  const relation = (id: number | null | undefined) =>
    id
      ? { connect: { id } }
      : id === null && mode === 'update'
        ? { disconnect: true }
        : undefined;

  return {
    section: relation(ids.sectionId),
    sampleType: relation(ids.sampleTypeId),
    technique: relation(ids.techniqueId),
  };
}

const PANEL_ITEMS_INCLUDE = {
  orderBy: { order: 'asc' },
  select: {
    order: true,
    child: {
      select: {
        id: true,
        code: true,
        name: true,
        abbreviation: true,
        isPanel: true,
        isOrderable: true,
      },
    },
  },
} satisfies Prisma.Study$panelItemsArgs;

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertServiceBelongsToBranch(
    serviceId: string,
    branchId: string,
  ) {
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

  // Los catálogos son por sucursal: deben ser de la sucursal del estudio.
  // `activeIds` son los que vienen en el request (no se permite asignar uno
  // inactivo); los ya guardados solo se revalidan por sucursal.
  private async assertCatalogsBelongToBranch(
    ids: StudyCatalogIds,
    branchId: string,
    activeIds: StudyCatalogIds = ids,
  ) {
    for (const [field, kind] of CATALOG_ID_FIELDS) {
      const id = ids[field];
      if (!id) continue;

      const item = await studyCatalogDelegate(this.prisma, kind).findUnique({
        where: { id },
      });
      const { label } = STUDY_CATALOGS[kind];
      if (!item) {
        throw new NotFoundException(`No existe ${label} con id ${id}`);
      }
      if (item.branchId !== branchId) {
        throw new BadRequestException(
          `${label[0].toUpperCase()}${label.slice(1)} seleccionada pertenece a otra sucursal`,
        );
      }
      if (activeIds[field] === id && !item.isActive) {
        throw new BadRequestException(
          `${label[0].toUpperCase()}${label.slice(1)} "${item.name}" está inactiva`,
        );
      }
    }
  }

  // minAge/maxAge tienen default en DB, así que en un update parcial se
  // compara contra el valor ya guardado del campo que no viene en el body.
  private assertValidAgeRange(minAge?: number, maxAge?: number) {
    if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
      throw new BadRequestException(
        'La edad mínima no puede ser mayor que la edad máxima',
      );
    }
  }

  private async assertPriceSheetsBelongToBranch(
    priceSheetIds: string[],
    branchId: string,
  ) {
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
    const {
      name,
      studyPrices,
      serviceId,
      branchId,
      sectionId,
      sampleTypeId,
      techniqueId,
      ...studyData
    } = createStudyDto;
    const slug = generateSlug(name);
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    this.assertValidAgeRange(
      studyData.minAge ?? DEFAULT_MIN_AGE,
      studyData.maxAge ?? DEFAULT_MAX_AGE,
    );
    await this.assertServiceBelongsToBranch(serviceId, branchId);
    await this.assertCatalogsBelongToBranch(catalogIds, branchId);
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
          ...catalogRelations(catalogIds, 'create'),
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
          ...CATALOG_INCLUDE,
        },
      });
    } catch (error: any) {
      console.log(error);
      handleDatabaseErrors(error, 'Study');
    }
  }

  async findAll(dto: PaginationDto) {
    const {
      priceSheetId,
      branchId,
      isPanel,
      isOrderable,
      sectionId,
      sampleTypeId,
      techniqueId,
    } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'code', 'abbreviation', 'title'],
      defaultSort: { name: 'asc' },
      allowedFields: STUDY_ALLOWED_FIELDS,
      minSearchLength: 2,
    });

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
      ...(isPanel !== undefined && { isPanel }),
      ...(isOrderable !== undefined && { isOrderable }),
      ...(sectionId && { sectionId }),
      ...(sampleTypeId && { sampleTypeId }),
      ...(techniqueId && { techniqueId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take,
        where: whereClause,
        orderBy,
        include: {
          // Con branchId cada estudio muestra el precio de la hoja pública de
          // SU PROPIO servicio (Service.priceSheetId), no una hoja única
          // compartida por toda la sucursal. Sin branchId se usa el
          // priceSheetId explícito (vista admin de un tarifario puntual).
          service: { select: { priceSheetId: true } },
          _count: { select: { panelItems: true } },
          ...CATALOG_INCLUDE,
        },
      }),
      this.prisma.study.count({ where: whereClause }),
    ]);

    const priceSheetIdsToResolve = branchId
      ? [
          ...new Set(
            items
              .map((s) => s.service.priceSheetId)
              .filter((id): id is string => !!id),
          ),
        ]
      : priceSheetId
        ? [priceSheetId]
        : [];

    const priceEntries = priceSheetIdsToResolve.length
      ? await this.prisma.studyOnPriceSheet.findMany({
          where: {
            priceSheetId: { in: priceSheetIdsToResolve },
            studyId: { in: items.map((s) => s.id) },
          },
        })
      : [];

    const priceByKey = new Map(
      priceEntries.map((entry) => [
        `${entry.studyId}:${entry.priceSheetId}`,
        entry,
      ]),
    );

    const data = items.map((study) => {
      const { service, ...rest } = study;
      const effectivePriceSheetId = branchId
        ? service.priceSheetId
        : priceSheetId;
      const regionalPrice = effectivePriceSheetId
        ? priceByKey.get(`${study.id}:${effectivePriceSheetId}`)
        : undefined;

      return {
        ...rest,
        priceInfo: {
          showPrice: regionalPrice?.showPrice ?? false,
          price: regionalPrice?.showPrice ? regionalPrice.price : null,
          message: regionalPrice?.showPrice
            ? null
            : 'Para mayor información consulte en sucursal',
          // Agregamos esto para debug o por si el estado no tiene precio cargado
          hasConfiguredPrice: !!regionalPrice,
        },
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
        ...CATALOG_INCLUDE,
        panelItems: PANEL_ITEMS_INCLUDE,
        parentPanels: {
          select: {
            panel: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    return study;
  }

  // Árbol completo del perfil (los sub-perfiles traen sus propios hijos).
  async getPanelTree(id: string, branchId?: string) {
    const study = await this.prisma.study.findFirst({
      where: { OR: [{ id }, { slug: id }], ...(branchId && { branchId }) },
      select: { id: true, code: true, name: true, isPanel: true },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    return {
      ...study,
      children: study.isPanel ? await loadPanelTree(this.prisma, study.id) : [],
    };
  }

  async setPanelItems(id: string, dto: SetPanelItemsDto) {
    const panel = await this.prisma.study.findUnique({
      where: { id },
      select: { id: true, branchId: true, isPanel: true },
    });
    if (!panel) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }
    if (!panel.isPanel) {
      throw new BadRequestException(
        'Solo un estudio marcado como perfil (isPanel) puede tener estudios hijos',
      );
    }

    const childIds = dto.items.map((item) => item.childId);
    if (new Set(childIds).size !== childIds.length) {
      throw new BadRequestException('El perfil contiene estudios repetidos');
    }
    if (childIds.includes(id)) {
      throw new BadRequestException('Un perfil no puede contenerse a sí mismo');
    }

    const children = await this.prisma.study.findMany({
      where: { id: { in: childIds } },
      select: { id: true, branchId: true },
    });
    if (
      children.length !== childIds.length ||
      children.some((c) => c.branchId !== panel.branchId)
    ) {
      throw new BadRequestException(
        'Todos los estudios del perfil deben existir y pertenecer a la misma sucursal del perfil',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const graph = await loadPanelGraph(tx, panel.branchId);
        graph.set(id, childIds);
        if (findPanelsInCycle(graph, [id]).length) {
          throw new BadRequestException(
            'La lista crea un ciclo: algún perfil hijo ya contiene (directa o indirectamente) a este perfil',
          );
        }

        await tx.studyPanelItem.deleteMany({ where: { panelId: id } });
        await tx.studyPanelItem.createMany({
          data: dto.items.map((item, index) => ({
            panelId: id,
            childId: item.childId,
            order: item.order ?? index,
          })),
        });
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Study');
    }

    return this.prisma.studyPanelItem.findMany({
      where: { panelId: id },
      ...PANEL_ITEMS_INCLUDE,
    });
  }

  async update(id: string, updateStudyDto: UpdateStudyDto) {
    const {
      name,
      serviceId,
      branchId,
      sectionId,
      sampleTypeId,
      techniqueId,
      ...studyData
    } = updateStudyDto;
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    this.assertValidAgeRange(
      studyData.minAge ?? existingStudy.minAge,
      studyData.maxAge ?? existingStudy.maxAge,
    );

    if (studyData.isPanel === false && existingStudy.isPanel) {
      const childCount = await this.prisma.studyPanelItem.count({
        where: { panelId: id },
      });
      if (childCount > 0) {
        throw new BadRequestException(
          `No se puede desmarcar como perfil: aún tiene ${childCount} estudio(s) hijo(s). Elimínalos primero.`,
        );
      }
    }

    if (branchId && branchId !== existingStudy.branchId) {
      const panelLinks = await this.prisma.studyPanelItem.count({
        where: { OR: [{ panelId: id }, { childId: id }] },
      });
      if (panelLinks > 0) {
        throw new BadRequestException(
          'No se puede cambiar de sucursal un estudio que es perfil con hijos o que forma parte de un perfil',
        );
      }
    }

    const effectiveBranchId = branchId ?? existingStudy.branchId;
    const effectiveServiceId = serviceId ?? existingStudy.serviceId;
    if (branchId || serviceId) {
      await this.assertServiceBelongsToBranch(
        effectiveServiceId,
        effectiveBranchId,
      );
    }
    // Con cambio de sucursal también se revalidan los catálogos ya guardados.
    await this.assertCatalogsBelongToBranch(
      {
        sectionId:
          sectionId !== undefined ? sectionId : existingStudy.sectionId,
        sampleTypeId:
          sampleTypeId !== undefined
            ? sampleTypeId
            : existingStudy.sampleTypeId,
        techniqueId:
          techniqueId !== undefined ? techniqueId : existingStudy.techniqueId,
      },
      effectiveBranchId,
      catalogIds,
    );

    try {
      return await this.prisma.study.update({
        where: { id },
        data: {
          ...studyData,
          ...catalogRelations(catalogIds, 'update'),
          ...(name && { name, slug: generateSlug(name) }),
          ...(serviceId && { service: { connect: { id: serviceId } } }),
          ...(branchId && { branch: { connect: { id: branchId } } }),
        },
        include: {
          service: {
            select: { name: true, slug: true },
          },
          priceSheets: true,
          ...CATALOG_INCLUDE,
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

  async exportByBranch(
    branchId: string,
  ): Promise<{ buffer: Buffer; branchName: string }> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with id ${branchId} not found`);
    }

    const studies = await this.prisma.study.findMany({
      where: { branchId },
      select: {
        code: true,
        abbreviation: true,
        name: true,
        title: true,
        section: { select: { name: true } },
        sampleType: { select: { name: true } },
        technique: { select: { name: true } },
        isPanel: true,
        isOrderable: true,
        panelItems: {
          orderBy: { order: 'asc' },
          select: { child: { select: { code: true } } },
        },
        gender: true,
        ageFormat: true,
        minAge: true,
        maxAge: true,
        decimals: true,
        deliveryTime: true,
      },
      orderBy: { name: 'asc' },
    });

    // Una sola lista de columnas para que encabezado y valores no se
    // desalineen al agregar o reordenar campos.
    const columns: Array<{
      header: string;
      value: (s: (typeof studies)[number]) => string | number;
    }> = [
      { header: 'Código', value: (s) => s.code },
      { header: 'Abreviatura', value: (s) => s.abbreviation ?? '' },
      { header: 'Nombre', value: (s) => s.name },
      { header: 'Título', value: (s) => s.title ?? '' },
      { header: 'Sección', value: (s) => s.section?.name ?? '' },
      { header: 'Tipo de muestra', value: (s) => s.sampleType?.name ?? '' },
      { header: 'Técnica', value: (s) => s.technique?.name ?? '' },
      { header: 'Es perfil', value: (s) => (s.isPanel ? 'Sí' : 'No') },
      {
        header: 'Parámetros',
        value: (s) => s.panelItems.map((i) => i.child.code).join(','),
      },
      { header: 'Vendible', value: (s) => (s.isOrderable ? 'Sí' : 'No') },
      { header: 'Género', value: (s) => s.gender },
      { header: 'Formato de edad', value: (s) => s.ageFormat },
      { header: 'Edad mínima', value: (s) => s.minAge },
      { header: 'Edad máxima', value: (s) => s.maxAge },
      { header: 'Decimales', value: (s) => s.decimals },
      { header: 'Tiempo de entrega', value: (s) => s.deliveryTime ?? '' },
    ];

    const sheet = XLSX.utils.aoa_to_sheet([
      columns.map((c) => c.header),
      ...studies.map((s) => columns.map((c) => c.value(s))),
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Estudios');

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    return { buffer, branchName: branch.name };
  }

  async remove(id: string) {
    const existingStudy = await this.prisma.study.findUnique({
      where: { id },
    });
    if (!existingStudy) {
      throw new NotFoundException(`Study with id ${id} not found`);
    }

    // Sus propios hijos (si es perfil) se desvinculan en cascada; lo que se
    // bloquea es borrar un estudio que todavía forma parte de algún perfil.
    const parentPanels = await this.prisma.studyPanelItem.findMany({
      where: { childId: id },
      select: { panel: { select: { code: true } } },
    });
    if (parentPanels.length) {
      throw new BadRequestException(
        `No se puede eliminar: el estudio forma parte de los perfiles ${parentPanels
          .map((p) => p.panel.code)
          .join(', ')}`,
      );
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
}
