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
import { QueryFilterDto } from 'src/common/dto/paginated-query.dto';
import { SetPanelItemsDto } from './dto/set-panel-items.dto';
import { CreateReferenceValueDto } from './dto/reference-value.dto';
import { EligiblePatientsDto } from './dto/eligible-patients.dto';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { generateSlug } from 'src/common/utils/slugger.util';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
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
import {
  STUDY_DEFAULT_MAX_AGE,
  STUDY_DEFAULT_MIN_AGE,
} from './constants/study-fields.const';

const STUDY_ALLOWED_FIELDS = [
  'name',
  'code',
  'abbreviation',
  'section.name',
  'sampleType.name',
  'technique.name',
  'isActive',
  'isPanel',
  'units',
  'gender',
  'ageFormat',
  'minAge',
  'maxAge',
  'deliveryTime',
  'createdAt',
];

const CATALOG_INCLUDE = {
  section: { select: { id: true, name: true } },
  sampleType: { select: { id: true, name: true } },
  technique: { select: { id: true, name: true } },
} satisfies Prisma.StudyInclude;

const REFERENCE_VALUES_INCLUDE = {
  orderBy: { order: 'asc' },
} satisfies Prisma.Study$referenceValuesArgs;

const STUDY_WRITE_INCLUDE = {
  service: { select: { name: true, slug: true } },
  priceSheets: true,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  ...CATALOG_INCLUDE,
} satisfies Prisma.StudyInclude;

const REFERENCE_VALUE_RANGE_FIELDS = [
  'gender',
  'unitAge',
  'minAge',
  'maxAge',
  'minValue',
  'maxValue',
] as const satisfies ReadonlyArray<keyof CreateReferenceValueDto>;

const isSet = <T>(value: T | null | undefined): value is T =>
  value !== undefined && value !== null;

const ELIGIBLE_PATIENTS_PREFIX = 'eligiblePatients.';

const toColumnField = (field: string) =>
  field.startsWith(ELIGIBLE_PATIENTS_PREFIX)
    ? field.slice(ELIGIBLE_PATIENTS_PREFIX.length)
    : field;

function withColumnFields(dto: PaginationDto): PaginationDto {
  const mapFilters = (filters?: QueryFilterDto[]) =>
    filters?.map((filter) => ({
      ...filter,
      field: toColumnField(filter.field),
    }));

  return {
    ...dto,
    sort: dto.sort && { ...dto.sort, field: toColumnField(dto.sort.field) },
    filters: dto.filters && {
      or: mapFilters(dto.filters.or),
      and: mapFilters(dto.filters.and),
    },
  };
}

const studyNotFound = (id: string) =>
  new NotFoundException(`Estudio con el ID ${id} no encontrado`);

function toSlug(value: string) {
  const slug = generateSlug(value);
  if (!slug) {
    throw new BadRequestException(
      'El slug no puede quedar vacío: usa letras o números',
    );
  }
  return slug;
}

function handleStudyDbErrors(
  error: unknown,
  values: { code?: string; slug?: string } = {},
) {
  handleDatabaseErrors(error, 'Estudio', {
    notFound: 'Estudio no encontrado',
    conflict: (fields) =>
      fields.includes('code')
        ? `Ya existe un estudio con el código '${values.code}' en esta sucursal`
        : fields.includes('slug')
          ? `Ya existe un estudio con el slug '${values.slug}' en esta sucursal: envía un slug distinto`
          : fields.includes('studyId') || fields.includes('priceSheetId')
            ? 'El estudio ya tiene precio en esa lista de precios'
            : undefined,
    foreignKey:
      'El estudio tiene registros relacionados que impiden la operación',
  });
}

function catalogLabels(kind: StudyCatalogKind) {
  const { label } = STUDY_CATALOGS[kind];
  return {
    label,
    capitalized: `${label[0].toUpperCase()}${label.slice(1)}`,
    ending: label.startsWith('el ') ? 'o' : 'a',
  };
}

function eligiblePatientsData(eligiblePatients?: EligiblePatientsDto) {
  return {
    gender: eligiblePatients?.gender,
    ageFormat: eligiblePatients?.ageFormat,
    minAge: eligiblePatients?.minAge,
    maxAge: eligiblePatients?.maxAge,
  };
}

type EligiblePatientsColumns = {
  gender: string;
  ageFormat: string;
  minAge: number;
  maxAge: number;
};

function toStudyResponse<T extends EligiblePatientsColumns>(study: T) {
  const { gender, ageFormat, minAge, maxAge, ...rest } = study;
  return { ...rest, eligiblePatients: { gender, ageFormat, minAge, maxAge } };
}

function referenceValuesData(
  values: CreateReferenceValueDto[],
): Prisma.ReferenceValueCreateWithoutStudyInput[] {
  return values.map((value, order) => {
    const date = value.date ? new Date(value.date) : undefined;
    if (isSet(value.text)) {
      return { order, text: value.text.trim(), date };
    }
    return {
      order,
      gender: value.gender ?? 'AMBOS',
      unitAge: value.unitAge ?? 'Años',
      minAge: value.minAge ?? STUDY_DEFAULT_MIN_AGE,
      maxAge: value.maxAge ?? STUDY_DEFAULT_MAX_AGE,
      minValue: isSet(value.minValue)
        ? new Prisma.Decimal(value.minValue)
        : null,
      maxValue: isSet(value.maxValue)
        ? new Prisma.Decimal(value.maxValue)
        : null,
      date,
    };
  });
}

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
      },
    },
  },
} satisfies Prisma.Study$panelItemsArgs;

const STUDY_DETAIL_INCLUDE = {
  priceSheets: { include: { priceSheet: true } },
  service: true,
  ...CATALOG_INCLUDE,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  panelItems: PANEL_ITEMS_INCLUDE,
  parentPanels: {
    select: { panel: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.StudyInclude;

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findAccessibleStudy(id: string, user: BranchScopedUser) {
    const study = await this.prisma.study.findUnique({
      where: { id },
      include: { _count: { select: { referenceValues: true } } },
    });
    if (!study) throw studyNotFound(id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  private async assertNotInAnyPanel(id: string) {
    const parentPanels = await this.prisma.studyPanelItem.findMany({
      where: { childId: id },
      select: { panel: { select: { code: true } } },
    });
    if (parentPanels.length) {
      throw new BadRequestException(
        `No se puede desactivar: el estudio forma parte de los perfiles ${parentPanels
          .map((p) => p.panel.code)
          .join(', ')}. Quítalo de esos perfiles primero.`,
      );
    }
  }

  private async assertServiceBelongsToBranch(
    serviceId: string,
    branchId: string,
  ) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { branchId: true },
    });
    if (!service) {
      throw new NotFoundException(
        `Servicio con el ID ${serviceId} no encontrado`,
      );
    }
    if (service.branchId !== branchId) {
      throw new BadRequestException(
        'El servicio seleccionado pertenece a otra sucursal',
      );
    }
  }

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
      const { label, capitalized, ending } = catalogLabels(kind);
      if (!item) {
        throw new NotFoundException(`No existe ${label} con el ID ${id}`);
      }
      if (item.branchId !== branchId) {
        throw new BadRequestException(
          `${capitalized} seleccionad${ending} pertenece a otra sucursal`,
        );
      }
      if (activeIds[field] === id && !item.isActive) {
        throw new BadRequestException(
          `${capitalized} "${item.name}" está inactiv${ending}`,
        );
      }
    }
  }

  private assertValidAgeRange(minAge?: number, maxAge?: number) {
    if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
      throw new BadRequestException(
        'eligiblePatients: la edad mínima no puede ser mayor que la edad máxima',
      );
    }
  }

  private assertPanelHasNoMeasurement(
    isPanel: boolean,
    {
      units,
      decimals,
      referenceValues,
    }: {
      units?: string | null;
      decimals?: number | null;
      referenceValues?: unknown[];
    },
  ) {
    if (!isPanel) return;
    const invalid = [
      ...(isSet(units) ? ['units'] : []),
      ...(isSet(decimals) ? ['decimals'] : []),
      ...(referenceValues?.length ? ['referenceValues'] : []),
    ];
    if (invalid.length) {
      throw new BadRequestException(
        `Un perfil (isPanel = true) no puede tener ${invalid.join(' ni ')}: solo aplican a estudios individuales (los hijos del perfil)`,
      );
    }
  }

  private assertValidReferenceValues(values: CreateReferenceValueDto[]) {
    values.forEach((value, index) => {
      const label = `referenceValues[${index}]`;

      if (isSet(value.text)) {
        const rangeFields = REFERENCE_VALUE_RANGE_FIELDS.filter((field) =>
          isSet(value[field]),
        );
        if (rangeFields.length) {
          throw new BadRequestException(
            `${label}: un valor cualitativo (text) no puede incluir ${rangeFields.join(', ')}`,
          );
        }
        return;
      }

      const { minValue, maxValue } = value;
      if (!isSet(minValue) && !isSet(maxValue)) {
        throw new BadRequestException(
          `${label}: indica text (cualitativo) o al menos minValue/maxValue (cuantitativo)`,
        );
      }
      if (isSet(minValue) && isSet(maxValue) && minValue > maxValue) {
        throw new BadRequestException(
          `${label}: minValue no puede ser mayor que maxValue`,
        );
      }
      if (
        (value.minAge ?? STUDY_DEFAULT_MIN_AGE) >
        (value.maxAge ?? STUDY_DEFAULT_MAX_AGE)
      ) {
        throw new BadRequestException(
          `${label}: minAge no puede ser mayor que maxAge`,
        );
      }
    });
  }

  private async assertPriceSheetsBelongToBranch(
    priceSheetIds: string[],
    branchId: string,
  ) {
    if (!priceSheetIds.length) return;
    if (new Set(priceSheetIds).size !== priceSheetIds.length) {
      throw new BadRequestException(
        'studyPrices no puede repetir la misma lista de precios',
      );
    }

    const priceSheets = await this.prisma.priceSheets.findMany({
      where: { id: { in: priceSheetIds } },
      select: { id: true, branchId: true },
    });

    const foreign = priceSheets.find((ps) => ps.branchId !== branchId);
    if (foreign || priceSheets.length !== priceSheetIds.length) {
      throw new BadRequestException(
        'Todas las listas de precios asignadas deben existir y pertenecer a la sucursal del estudio',
      );
    }
  }

  async create(createStudyDto: CreateStudyDto, user: BranchScopedUser) {
    const {
      name,
      studyPrices,
      serviceId,
      branchId,
      sectionId,
      sampleTypeId,
      techniqueId,
      units,
      decimals,
      eligiblePatients,
      referenceValues,
      slug: slugInput,
      ...studyData
    } = createStudyDto;
    assertBranchAccess(user, branchId);
    const slug = toSlug(slugInput ?? name);
    const catalogIds = { sectionId, sampleTypeId, techniqueId };
    const isPanel = studyData.isPanel ?? false;

    this.assertPanelHasNoMeasurement(isPanel, {
      units,
      decimals,
      referenceValues,
    });
    this.assertValidAgeRange(
      eligiblePatients?.minAge ?? STUDY_DEFAULT_MIN_AGE,
      eligiblePatients?.maxAge ?? STUDY_DEFAULT_MAX_AGE,
    );
    if (referenceValues?.length) {
      this.assertValidReferenceValues(referenceValues);
    }
    await this.assertServiceBelongsToBranch(serviceId, branchId);
    await this.assertCatalogsBelongToBranch(catalogIds, branchId);
    if (studyPrices?.length) {
      await this.assertPriceSheetsBelongToBranch(
        studyPrices.map((p) => p.priceSheetId),
        branchId,
      );
    }

    try {
      const study = await this.prisma.study.create({
        data: {
          ...studyData,
          ...eligiblePatientsData(eligiblePatients),
          ...catalogRelations(catalogIds, 'create'),
          units: isPanel ? null : units,
          decimals: isPanel ? null : decimals,
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
          ...(referenceValues?.length && {
            referenceValues: { create: referenceValuesData(referenceValues) },
          }),
        },
        include: STUDY_WRITE_INCLUDE,
      });
      return toStudyResponse(study);
    } catch (error) {
      handleStudyDbErrors(error, { code: studyData.code, slug });
    }
  }

  findAll(dto: PaginationDto) {
    return this.findStudies(dto, { isActive: true });
  }

  findInactive(dto: PaginationDto, user: BranchScopedUser) {
    return this.findStudies(dto, {
      isActive: false,
      ...userBranchFilter(user, dto.branchId),
    });
  }

  findOrderable(dto: PaginationDto) {
    return this.findStudies(dto, {
      isActive: true,
      priceSheets: {
        some: {
          priceSheet: { isActive: true },
          ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
        },
      },
    });
  }

  private async findStudies(
    dto: PaginationDto,
    extraWhere: Prisma.StudyWhereInput = {},
  ) {
    const {
      priceSheetId,
      branchId,
      isPanel,
      sectionId,
      sampleTypeId,
      techniqueId,
      gender,
      ageFormat,
      minAge,
      maxAge,
    } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(
      withColumnFields(dto),
      {
        searchFields: ['name', 'code', 'abbreviation'],
        defaultSort: { name: 'asc' },
        allowedFields: STUDY_ALLOWED_FIELDS,
        minSearchLength: 2,
      },
    );

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
      ...(isPanel !== undefined && { isPanel }),
      ...(sectionId && { sectionId }),
      ...(sampleTypeId && { sampleTypeId }),
      ...(techniqueId && { techniqueId }),
      ...(gender && { gender }),
      ...(ageFormat && { ageFormat }),
      ...(minAge !== undefined && { minAge: { gte: minAge } }),
      ...(maxAge !== undefined && { maxAge: { lte: maxAge } }),
      ...extraWhere,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.study.findMany({
        skip,
        take,
        where: whereClause,
        orderBy,
        include: {
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
        ...toStudyResponse(rest),
        priceInfo: {
          showPrice: regionalPrice?.showPrice ?? false,
          price: regionalPrice?.showPrice ? regionalPrice.price : null,
          message: regionalPrice?.showPrice
            ? null
            : 'Para mayor información consulte en sucursal',
          hasConfiguredPrice: !!regionalPrice,
        },
      };
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  findOne(id: string) {
    return this.findDetail({ id, isActive: true }, id);
  }

  async findInactiveOne(id: string, user: BranchScopedUser) {
    const study = await this.findDetail({ id, isActive: false }, id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  async findBySlug(slug: string, branchId: string) {
    const study = await this.prisma.study.findUnique({
      where: { branchId_slug: { branchId, slug }, isActive: true },
      include: STUDY_DETAIL_INCLUDE,
    });
    if (!study) {
      throw new NotFoundException(
        `Estudio con el slug '${slug}' no encontrado en esta sucursal`,
      );
    }
    return toStudyResponse(study);
  }

  private async findDetail(where: Prisma.StudyWhereInput, id: string) {
    const study = await this.prisma.study.findFirst({
      where,
      include: STUDY_DETAIL_INCLUDE,
    });
    if (!study) throw studyNotFound(id);
    return toStudyResponse(study);
  }

  async getPanelTree(id: string) {
    const study = await this.prisma.study.findFirst({
      where: { id, isActive: true },
      select: { id: true, code: true, name: true, isPanel: true },
    });
    if (!study) throw studyNotFound(id);

    return {
      ...study,
      children: study.isPanel ? await loadPanelTree(this.prisma, study.id) : [],
    };
  }

  async setPanelItems(
    id: string,
    dto: SetPanelItemsDto,
    user: BranchScopedUser,
  ) {
    const panel = await this.findAccessibleStudy(id, user);
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
      select: { id: true, code: true, branchId: true, isActive: true },
    });
    if (
      children.length !== childIds.length ||
      children.some((c) => c.branchId !== panel.branchId)
    ) {
      throw new BadRequestException(
        'Todos los estudios del perfil deben existir y pertenecer a la misma sucursal del perfil',
      );
    }
    const inactiveChildren = children.filter((c) => !c.isActive);
    if (inactiveChildren.length) {
      throw new BadRequestException(
        `Un perfil solo puede contener estudios activos: ${inactiveChildren
          .map((c) => c.code)
          .join(', ')}`,
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
      handleStudyDbErrors(error);
    }

    return this.prisma.studyPanelItem.findMany({
      where: { panelId: id },
      ...PANEL_ITEMS_INCLUDE,
    });
  }

  async update(
    id: string,
    updateStudyDto: UpdateStudyDto,
    user: BranchScopedUser,
  ) {
    const {
      name,
      serviceId,
      sectionId,
      sampleTypeId,
      techniqueId,
      units,
      decimals,
      eligiblePatients,
      referenceValues,
      slug: slugInput,
      ...studyData
    } = updateStudyDto;
    const slug = slugInput !== undefined ? toSlug(slugInput) : undefined;
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    const existingStudy = await this.findAccessibleStudy(id, user);

    const isPanel = studyData.isPanel ?? existingStudy.isPanel;
    this.assertPanelHasNoMeasurement(isPanel, {
      units,
      decimals,
      referenceValues,
    });
    const storedReferenceValues = existingStudy._count.referenceValues;
    if (isPanel && referenceValues === undefined && storedReferenceValues) {
      throw new BadRequestException(
        `No se puede marcar como perfil: tiene ${storedReferenceValues} valor(es) de referencia. Envía referenceValues: [] para eliminarlos.`,
      );
    }
    this.assertValidAgeRange(
      eligiblePatients?.minAge ?? existingStudy.minAge,
      eligiblePatients?.maxAge ?? existingStudy.maxAge,
    );
    if (referenceValues) {
      this.assertValidReferenceValues(referenceValues);
    }

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

    if (studyData.isActive === false && existingStudy.isActive) {
      await this.assertNotInAnyPanel(id);
    }

    if (serviceId) {
      await this.assertServiceBelongsToBranch(
        serviceId,
        existingStudy.branchId,
      );
    }
    await this.assertCatalogsBelongToBranch(catalogIds, existingStudy.branchId);

    try {
      const study = await this.prisma.study.update({
        where: { id },
        data: {
          ...studyData,
          ...eligiblePatientsData(eligiblePatients),
          ...catalogRelations(catalogIds, 'update'),
          ...(isPanel ? { units: null, decimals: null } : { units, decimals }),
          ...(referenceValues && {
            referenceValues: {
              deleteMany: {},
              create: referenceValuesData(referenceValues),
            },
          }),
          ...(name && { name }),
          ...(slug && { slug }),
          ...(serviceId && { service: { connect: { id: serviceId } } }),
        },
        include: STUDY_WRITE_INCLUDE,
      });
      return toStudyResponse(study);
    } catch (error) {
      handleStudyDbErrors(error, {
        code: studyData.code ?? existingStudy.code,
        slug: slug ?? existingStudy.slug,
      });
    }
  }

  async assignPriceSheet(
    studyId: string,
    dto: AssignPriceSheetDto,
    user: BranchScopedUser,
  ) {
    const study = await this.findAccessibleStudy(studyId, user);

    const priceSheet = await this.prisma.priceSheets.findUnique({
      where: { id: dto.priceSheetId },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `Lista de precios con el ID ${dto.priceSheetId} no encontrada`,
      );
    }
    if (priceSheet.branchId !== study.branchId) {
      throw new BadRequestException(
        'La lista de precios pertenece a otra sucursal distinta a la del estudio',
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
      handleStudyDbErrors(error);
    }
  }

  async removePriceSheet(
    studyId: string,
    priceSheetId: string,
    user: BranchScopedUser,
  ) {
    await this.findAccessibleStudy(studyId, user);
    const assignment = await this.prisma.studyOnPriceSheet.findUnique({
      where: { studyId_priceSheetId: { studyId, priceSheetId } },
    });
    if (!assignment) {
      throw new NotFoundException(
        `El estudio ${studyId} no tiene precio asignado en la lista de precios ${priceSheetId}`,
      );
    }

    try {
      return await this.prisma.studyOnPriceSheet.delete({
        where: { studyId_priceSheetId: { studyId, priceSheetId } },
      });
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }

  async exportByBranch(
    branchId: string,
    user: BranchScopedUser,
  ): Promise<{ buffer: Buffer; branchName: string }> {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${branchId} no encontrada`,
      );
    }

    const [studies, priceSheets] = await Promise.all([
      this.prisma.study.findMany({
        where: { branchId },
        select: {
          id: true,
          code: true,
          abbreviation: true,
          name: true,
          slug: true,
          isActive: true,
          section: { select: { name: true } },
          sampleType: { select: { name: true } },
          technique: { select: { name: true } },
          isPanel: true,
          panelItems: {
            orderBy: { order: 'asc' },
            select: { child: { select: { code: true } } },
          },
          gender: true,
          ageFormat: true,
          minAge: true,
          maxAge: true,
          units: true,
          decimals: true,
          deliveryTime: true,
          priceSheets: {
            select: { priceSheetId: true, price: true, showPrice: true },
          },
          referenceValues: REFERENCE_VALUES_INCLUDE,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.priceSheets.findMany({
        where: { branchId },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    type ExportedStudy = (typeof studies)[number];
    type Column<T> = { header: string; value: (row: T) => string | number };

    const priceColumns: Column<ExportedStudy>[] = priceSheets.map((sheet) => ({
      header: `Precio: ${sheet.name}${sheet.isActive ? '' : ' (inactiva)'}`,
      value: (s) => {
        const entry = s.priceSheets.find((p) => p.priceSheetId === sheet.id);
        if (!entry) return '';
        return entry.showPrice
          ? Number(entry.price)
          : `${Number(entry.price)} (oculto)`;
      },
    }));

    const studyColumns: Column<ExportedStudy>[] = [
      { header: 'Código', value: (s) => s.code },
      { header: 'Abreviatura', value: (s) => s.abbreviation ?? '' },
      { header: 'Nombre', value: (s) => s.name },
      { header: 'Slug', value: (s) => s.slug },
      { header: 'Activo', value: (s) => (s.isActive ? 'Sí' : 'No') },
      { header: 'Sección', value: (s) => s.section?.name ?? '' },
      { header: 'Tipo de muestra', value: (s) => s.sampleType?.name ?? '' },
      { header: 'Técnica', value: (s) => s.technique?.name ?? '' },
      { header: 'Es perfil', value: (s) => (s.isPanel ? 'Sí' : 'No') },
      {
        header: 'Parámetros',
        value: (s) => s.panelItems.map((i) => i.child.code).join(','),
      },
      {
        header: 'Vendible',
        value: (s) => (s.priceSheets.length > 0 ? 'Sí' : 'No'),
      },
      { header: 'Género', value: (s) => s.gender },
      { header: 'Formato de edad', value: (s) => s.ageFormat },
      { header: 'Edad mínima', value: (s) => s.minAge },
      { header: 'Edad máxima', value: (s) => s.maxAge },
      { header: 'Unidades', value: (s) => s.units ?? '' },
      { header: 'Decimales', value: (s) => s.decimals ?? '' },
      {
        header: 'Tiempo de entrega (días)',
        value: (s) => s.deliveryTime ?? '',
      },
      ...priceColumns,
    ];

    type ExportedReferenceValue = ExportedStudy['referenceValues'][number] & {
      studyCode: string;
    };
    const referenceColumns: Column<ExportedReferenceValue>[] = [
      { header: 'Código del estudio', value: (r) => r.studyCode },
      { header: 'Orden', value: (r) => r.order + 1 },
      {
        header: 'Tipo',
        value: (r) => (r.text !== null ? 'Cualitativo' : 'Cuantitativo'),
      },
      { header: 'Género', value: (r) => r.gender ?? '' },
      { header: 'Unidad de edad', value: (r) => r.unitAge ?? '' },
      { header: 'Edad mínima', value: (r) => r.minAge ?? '' },
      { header: 'Edad máxima', value: (r) => r.maxAge ?? '' },
      {
        header: 'Valor mínimo',
        value: (r) => (r.minValue !== null ? Number(r.minValue) : ''),
      },
      {
        header: 'Valor máximo',
        value: (r) => (r.maxValue !== null ? Number(r.maxValue) : ''),
      },
      { header: 'Texto', value: (r) => r.text ?? '' },
      {
        header: 'Fecha',
        value: (r) => r.date.toISOString().slice(0, 10),
      },
    ];
    const referenceValues = studies.flatMap((s) =>
      s.referenceValues.map((r) => ({ ...r, studyCode: s.code })),
    );

    const toSheet = <T>(columns: Column<T>[], rows: T[]) =>
      XLSX.utils.aoa_to_sheet([
        columns.map((c) => c.header),
        ...rows.map((row) => columns.map((c) => c.value(row))),
      ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      toSheet(studyColumns, studies),
      'Estudios',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      toSheet(referenceColumns, referenceValues),
      'Valores de referencia',
    );

    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    return { buffer, branchName: branch.name };
  }

  async remove(id: string, user: BranchScopedUser) {
    await this.findAccessibleStudy(id, user);
    await this.assertNotInAnyPanel(id);

    try {
      const study = await this.prisma.study.update({
        where: { id },
        data: { isActive: false },
        include: STUDY_WRITE_INCLUDE,
      });
      return toStudyResponse(study);
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }
}
