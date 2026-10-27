import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CreateStudyDto, StudyPriceDto } from './dto/create-study.dto';
import { UpdateStudyDto } from './dto/update-study.dto';
import { AssignPriceSheetDto } from './dto/assign-price-sheet.dto';
import { PaginationDto } from './dto/pagination-study.dto';
import { QueryFilterDto } from 'src/common/dto/paginated-query.dto';
import { SetPanelItemsDto } from './dto/set-panel-items.dto';
import { CreateReferenceValueDto } from './dto/reference-value.dto';
import { EligiblePatientsDto } from './dto/eligible-patients.dto';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
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
import { studyTitle } from './utils/study-title.util';

const STUDY_ALLOWED_FIELDS = [
  'name',
  'title',
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

/** Adds which study failed (e.g. form.panelItems[2].newStudy) to an error. */
function prefixError(error: unknown, label: string) {
  if (error instanceof BadRequestException) {
    const response = error.getResponse() as { message?: string | string[] };
    const messages = Array.isArray(response.message)
      ? response.message
      : [response.message ?? error.message];
    return new BadRequestException(messages.map((m) => `${label}: ${m}`));
  }
  return error;
}

function eligiblePatientsData(eligiblePatients?: EligiblePatientsDto) {
  return {
    gender: eligiblePatients?.gender,
    ageFormat: eligiblePatients?.ageFormat,
    minAge: eligiblePatients?.minAge,
    maxAge: eligiblePatients?.maxAge,
  };
}

type StudyResponseColumns = {
  name: string;
  title: string | null;
  gender: string;
  ageFormat: string;
  minAge: number;
  maxAge: number;
};

/** Prisma client or the client of an interactive transaction. */
export type StudyDb = Prisma.TransactionClient;

export function toStudyResponse<T extends StudyResponseColumns>(study: T) {
  const { gender, ageFormat, minAge, maxAge, ...rest } = study;
  return {
    ...rest,
    title: studyTitle(study),
    eligiblePatients: { gender, ageFormat, minAge, maxAge },
  };
}

type StudyProviderColumns = {
  isInternal: boolean;
  providerName: string | null;
  providerCost: Prisma.Decimal | null;
};

/** Public responses never reveal that a study is outsourced, to whom or at what cost. */
function withoutProviderInfo<T extends StudyProviderColumns>(study: T) {
  const {
    isInternal: _isInternal,
    providerName: _providerName,
    providerCost: _providerCost,
    ...rest
  } = study;
  return rest;
}

/** Columns to write: an internal study never keeps provider data. */
function providerData(
  isInternal: boolean,
  {
    providerName,
    providerCost,
  }: Pick<UpdateStudyDto, 'providerName' | 'providerCost'>,
) {
  if (isInternal) return { providerName: null, providerCost: null };
  return {
    providerName,
    providerCost: isSet(providerCost)
      ? new Prisma.Decimal(providerCost)
      : providerCost,
  };
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
        title: true,
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
    select: {
      panel: { select: { id: true, code: true, name: true, title: true } },
    },
  },
} satisfies Prisma.StudyInclude;

// Public responses must never expose another sheet's prices (partner sheets
// are private): no priceSheets array, only the service's public sheet price.
const STUDY_PUBLIC_DETAIL_INCLUDE = {
  service: { select: { id: true, name: true, slug: true, priceSheetId: true } },
  ...CATALOG_INCLUDE,
  referenceValues: REFERENCE_VALUES_INCLUDE,
  panelItems: PANEL_ITEMS_INCLUDE,
  parentPanels: STUDY_DETAIL_INCLUDE.parentPanels,
} satisfies Prisma.StudyInclude;

const PUBLIC_PRICE_SHEET_WHERE = {
  isPublic: true,
  isActive: true,
} satisfies Prisma.PriceSheetsWhereInput;

const NO_PUBLIC_PRICE_MESSAGE = 'Para mayor información consulte en sucursal';

function toPriceInfo(
  entry: { price: Prisma.Decimal; showPrice: boolean } | null | undefined,
) {
  return {
    showPrice: entry?.showPrice ?? false,
    price: entry?.showPrice ? entry.price : null,
    message: entry?.showPrice ? null : NO_PUBLIC_PRICE_MESSAGE,
  };
}

@Injectable()
export class StudiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findAccessibleStudy(
    id: string,
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const study = await db.study.findUnique({
      where: { id },
      include: { _count: { select: { referenceValues: true } } },
    });
    if (!study) throw studyNotFound(id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  private async assertNotInAnyPanel(id: string, db: StudyDb = this.prisma) {
    const parentPanels = await db.studyPanelItem.findMany({
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
    db: StudyDb = this.prisma,
  ) {
    const service = await db.service.findUnique({
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
    db: StudyDb = this.prisma,
  ) {
    for (const [field, kind] of CATALOG_ID_FIELDS) {
      const id = ids[field];
      if (!id) continue;

      const item = await studyCatalogDelegate(db, kind).findUnique({
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

  /** `storedProviderName` is the current value when updating. */
  private assertValidProvider(
    isInternal: boolean,
    {
      providerName,
      providerCost,
    }: { providerName?: string | null; providerCost?: number | null },
    storedProviderName: string | null = null,
  ) {
    if (isInternal) {
      const invalid = [
        ...(isSet(providerName) ? ['providerName'] : []),
        ...(isSet(providerCost) ? ['providerCost'] : []),
      ];
      if (invalid.length) {
        throw new BadRequestException(
          `Un estudio interno (isInternal = true) no puede tener ${invalid.join(' ni ')}: solo aplican a estudios maquilados`,
        );
      }
      return;
    }
    if (!(providerName ?? storedProviderName)) {
      throw new BadRequestException(
        'Un estudio maquilado (isInternal = false) requiere providerName (laboratorio maquilador)',
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

  async assertPriceSheetsBelongToBranch(
    priceSheetIds: string[],
    branchId: string,
    db: StudyDb = this.prisma,
  ) {
    if (!priceSheetIds.length) return;
    if (new Set(priceSheetIds).size !== priceSheetIds.length) {
      throw new BadRequestException(
        'studyPrices no puede repetir la misma lista de precios',
      );
    }

    const priceSheets = await db.priceSheets.findMany({
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

  /**
   * assertCreatable for many studies of one branch with a fixed number of
   * queries: services, each catalog and price sheets are read once for all.
   * `label` prefixes each study's errors (e.g. form.panelItems[3].newStudy).
   */
  async assertCreatableMany(
    items: {
      label: string;
      dto: Parameters<StudiesService['assertCreatable']>[0];
    }[],
    branchId: string,
    db: StudyDb = this.prisma,
  ) {
    if (!items.length) return;

    for (const { label, dto } of items) {
      try {
        this.assertPanelHasNoMeasurement(dto.isPanel ?? false, dto);
        this.assertValidProvider(dto.isInternal ?? true, dto);
        this.assertValidAgeRange(
          dto.eligiblePatients?.minAge ?? STUDY_DEFAULT_MIN_AGE,
          dto.eligiblePatients?.maxAge ?? STUDY_DEFAULT_MAX_AGE,
        );
        if (dto.referenceValues?.length) {
          this.assertValidReferenceValues(dto.referenceValues);
        }
        if (dto.studyPrices?.length) {
          const sheetIds = dto.studyPrices.map((p) => p.priceSheetId);
          if (new Set(sheetIds).size !== sheetIds.length) {
            throw new BadRequestException(
              'studyPrices no puede repetir la misma lista de precios',
            );
          }
        }
      } catch (error) {
        throw prefixError(error, label);
      }
    }

    const unique = <T>(values: (T | null | undefined)[]) => [
      ...new Set(values.filter((v): v is T => v !== null && v !== undefined)),
    ];

    const serviceIds = unique(items.map((i) => i.dto.serviceId));
    const services = await db.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, branchId: true },
    });
    const serviceBranch = new Map(services.map((s) => [s.id, s.branchId]));
    for (const { label, dto } of items) {
      const owner = serviceBranch.get(dto.serviceId);
      if (!owner) {
        throw new NotFoundException(
          `${label}: servicio con el ID ${dto.serviceId} no encontrado`,
        );
      }
      if (owner !== branchId) {
        throw new BadRequestException(
          `${label}: el servicio seleccionado pertenece a otra sucursal`,
        );
      }
    }

    for (const [field, kind] of CATALOG_ID_FIELDS) {
      const ids = unique(items.map((i) => i.dto[field]));
      if (!ids.length) continue;
      const rows = await studyCatalogDelegate(db, kind).findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const { label: kindLabel, capitalized, ending } = catalogLabels(kind);
      for (const { label, dto } of items) {
        const id = dto[field];
        if (!id) continue;
        const item = byId.get(id);
        if (!item) {
          throw new NotFoundException(
            `${label}: no existe ${kindLabel} con el ID ${id}`,
          );
        }
        if (item.branchId !== branchId) {
          throw new BadRequestException(
            `${label}: ${capitalized} seleccionad${ending} pertenece a otra sucursal`,
          );
        }
        if (!item.isActive) {
          throw new BadRequestException(
            `${label}: ${capitalized} "${item.name}" está inactiv${ending}`,
          );
        }
      }
    }

    const sheetIds = unique(
      items.flatMap((i) =>
        (i.dto.studyPrices ?? []).map((p) => p.priceSheetId),
      ),
    );
    if (sheetIds.length) {
      const sheets = await db.priceSheets.findMany({
        where: { id: { in: sheetIds } },
        select: { id: true, branchId: true },
      });
      if (
        sheets.length !== sheetIds.length ||
        sheets.some((sheet) => sheet.branchId !== branchId)
      ) {
        throw new BadRequestException(
          'Todas las listas de precios asignadas deben existir y pertenecer a la sucursal del estudio',
        );
      }
    }
  }

  /**
   * Creates many studies of one branch in a handful of queries (used for the
   * new parameters of a large panel). Same rules as create(); codes and slugs
   * are checked against the branch and among themselves first, so a conflict
   * names the offending code instead of failing the whole insert blindly.
   */
  async createMany(
    items: { label: string; dto: CreateStudyDto }[],
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    if (!items.length) return [];
    const branchId = items[0].dto.branchId;
    if (items.some((i) => i.dto.branchId !== branchId)) {
      throw new BadRequestException(
        'createMany: todos los estudios deben ser de la misma sucursal',
      );
    }
    assertBranchAccess(user, branchId);
    await this.assertCreatableMany(items, branchId, db);

    const rows = items.map(({ dto }) => ({
      id: randomUUID(),
      dto,
      slug: toSlug(dto.slug ?? dto.name),
    }));

    const repeated = (values: string[]) =>
      values.filter((value, index) => values.indexOf(value) !== index);
    const dupCodes = repeated(rows.map((r) => r.dto.code));
    if (dupCodes.length) {
      throw new ConflictException(
        `Códigos repetidos en la solicitud: ${[...new Set(dupCodes)].join(', ')}`,
      );
    }
    const dupSlugs = repeated(rows.map((r) => r.slug));
    if (dupSlugs.length) {
      throw new ConflictException(
        `Slugs repetidos en la solicitud: ${[...new Set(dupSlugs)].join(', ')}: envía un slug distinto`,
      );
    }
    const taken = await db.study.findMany({
      where: {
        branchId,
        OR: [
          { code: { in: rows.map((r) => r.dto.code) } },
          { slug: { in: rows.map((r) => r.slug) } },
        ],
      },
      select: { code: true, slug: true },
    });
    if (taken.length) {
      const codes = new Set(rows.map((r) => r.dto.code));
      const takenCodes = taken
        .filter((t) => codes.has(t.code))
        .map((t) => t.code);
      throw new ConflictException(
        takenCodes.length
          ? `Ya existe un estudio con el código ${takenCodes.map((c) => `'${c}'`).join(', ')} en esta sucursal`
          : `Ya existe un estudio con el slug ${taken.map((t) => `'${t.slug}'`).join(', ')} en esta sucursal: envía un slug distinto`,
      );
    }

    try {
      await db.study.createMany({
        data: rows.map(({ id, dto, slug }) => {
          const isPanel = dto.isPanel ?? false;
          return {
            id,
            branchId,
            serviceId: dto.serviceId,
            name: dto.name,
            title: dto.title ?? dto.name,
            slug,
            code: dto.code,
            abbreviation: dto.abbreviation,
            description: dto.description,
            preparation: dto.preparation,
            deliveryTime: dto.deliveryTime,
            isActive: dto.isActive,
            isPanel,
            units: isPanel ? null : dto.units,
            decimals: isPanel ? null : dto.decimals,
            isInternal: dto.isInternal ?? true,
            ...providerData(dto.isInternal ?? true, dto),
            sectionId: dto.sectionId,
            sampleTypeId: dto.sampleTypeId,
            techniqueId: dto.techniqueId ?? null,
            ...eligiblePatientsData(dto.eligiblePatients),
          };
        }),
      });
      const referenceValues = rows.flatMap(({ id, dto }) =>
        dto.referenceValues?.length && !dto.isPanel
          ? referenceValuesData(dto.referenceValues).map((value) => ({
              ...value,
              studyId: id,
            }))
          : [],
      );
      if (referenceValues.length) {
        await db.referenceValue.createMany({ data: referenceValues });
      }
      const prices = rows.flatMap(({ id, dto }) =>
        (dto.studyPrices ?? []).map((p) => ({
          studyId: id,
          priceSheetId: p.priceSheetId,
          price: new Prisma.Decimal(p.price),
          showPrice: p.showPrice ?? true,
        })),
      );
      if (prices.length) {
        await db.studyOnPriceSheet.createMany({ data: prices });
      }
    } catch (error) {
      handleStudyDbErrors(error);
    }

    return rows.map(({ id, dto }) => ({ id, code: dto.code, name: dto.name }));
  }

  /**
   * Business rules of a new study that don't depend on its code/slug. Also used
   * by ticket forms to validate a requested study before it's created.
   */
  async assertCreatable(
    dto: Pick<
      CreateStudyDto,
      | 'branchId'
      | 'serviceId'
      | 'sectionId'
      | 'sampleTypeId'
      | 'techniqueId'
      | 'isPanel'
      | 'units'
      | 'decimals'
      | 'isInternal'
      | 'providerName'
      | 'providerCost'
      | 'eligiblePatients'
      | 'referenceValues'
      | 'studyPrices'
    >,
    db: StudyDb = this.prisma,
  ) {
    const { branchId, eligiblePatients, referenceValues, studyPrices } = dto;
    const catalogIds = {
      sectionId: dto.sectionId,
      sampleTypeId: dto.sampleTypeId,
      techniqueId: dto.techniqueId,
    };

    this.assertPanelHasNoMeasurement(dto.isPanel ?? false, dto);
    this.assertValidProvider(dto.isInternal ?? true, dto);
    this.assertValidAgeRange(
      eligiblePatients?.minAge ?? STUDY_DEFAULT_MIN_AGE,
      eligiblePatients?.maxAge ?? STUDY_DEFAULT_MAX_AGE,
    );
    if (referenceValues?.length) {
      this.assertValidReferenceValues(referenceValues);
    }
    await this.assertServiceBelongsToBranch(dto.serviceId, branchId, db);
    await this.assertCatalogsBelongToBranch(
      catalogIds,
      branchId,
      catalogIds,
      db,
    );
    if (studyPrices?.length) {
      await this.assertPriceSheetsBelongToBranch(
        studyPrices.map((p) => p.priceSheetId),
        branchId,
        db,
      );
    }
  }

  async create(
    createStudyDto: CreateStudyDto,
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const {
      name,
      title,
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
      providerName,
      providerCost,
      slug: slugInput,
      ...studyData
    } = createStudyDto;
    assertBranchAccess(user, branchId);
    const slug = toSlug(slugInput ?? name);
    const catalogIds = { sectionId, sampleTypeId, techniqueId };
    const isPanel = studyData.isPanel ?? false;
    const isInternal = studyData.isInternal ?? true;

    await this.assertCreatable(createStudyDto, db);

    try {
      const study = await db.study.create({
        data: {
          ...studyData,
          ...eligiblePatientsData(eligiblePatients),
          ...catalogRelations(catalogIds, 'create'),
          units: isPanel ? null : units,
          decimals: isPanel ? null : decimals,
          ...providerData(isInternal, { providerName, providerCost }),
          service: {
            connect: { id: serviceId },
          },
          branch: {
            connect: { id: branchId },
          },
          name,
          title: title ?? name,
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

  async findAll(dto: PaginationDto) {
    await this.assertPublicPriceSheet(dto.priceSheetId);
    return this.findStudies(dto, { isActive: true }, true);
  }

  findInactive(dto: PaginationDto, user: BranchScopedUser) {
    return this.findStudies(
      dto,
      {
        isActive: false,
        ...userBranchFilter(user, dto.branchId),
      },
      false,
    );
  }

  async findOrderable(dto: PaginationDto) {
    await this.assertPublicPriceSheet(dto.priceSheetId);
    return this.findStudies(
      dto,
      {
        isActive: true,
        priceSheets: {
          some: {
            priceSheet: PUBLIC_PRICE_SHEET_WHERE,
            ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
          },
        },
      },
      true,
    );
  }

  /**
   * Admin quotation wizard: like findOrderable, but private (partner) sheets
   * count too, since admin quotations accept any active sheet of the branch.
   */
  async findAdminOrderable(dto: PaginationDto, user: BranchScopedUser) {
    const branchWhere = userBranchFilter(user, dto.branchId);
    if (dto.priceSheetId) {
      const priceSheet = await this.prisma.priceSheets.findFirst({
        where: { id: dto.priceSheetId, isActive: true, ...branchWhere },
        select: { id: true },
      });
      if (!priceSheet) {
        throw new NotFoundException(
          `Lista de precios con el ID ${dto.priceSheetId} no encontrada`,
        );
      }
    }
    return this.findStudies(
      dto,
      {
        isActive: true,
        ...branchWhere,
        priceSheets: {
          some: {
            priceSheet: { isActive: true },
            ...(dto.priceSheetId && { priceSheetId: dto.priceSheetId }),
          },
        },
      },
      false,
    );
  }

  /** Public routes may only read prices from public, active sheets. */
  private async assertPublicPriceSheet(priceSheetId?: string) {
    if (!priceSheetId) return;
    const priceSheet = await this.prisma.priceSheets.findFirst({
      where: { id: priceSheetId, ...PUBLIC_PRICE_SHEET_WHERE },
      select: { id: true },
    });
    if (!priceSheet) {
      throw new NotFoundException(
        `Lista de precios con el ID ${priceSheetId} no encontrada`,
      );
    }
  }

  private async findStudies(
    dto: PaginationDto,
    extraWhere: Prisma.StudyWhereInput,
    publicOnly: boolean,
  ) {
    const {
      priceSheetId,
      branchId,
      isPanel,
      isInternal,
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
        searchFields: ['name', 'title', 'code', 'abbreviation'],
        defaultSort: { name: 'asc' },
        allowedFields: STUDY_ALLOWED_FIELDS,
        minSearchLength: 2,
      },
    );

    const whereClause: Prisma.StudyWhereInput = {
      ...(where as Prisma.StudyWhereInput),
      ...(branchId && { branchId }),
      ...(isPanel !== undefined && { isPanel }),
      ...(isInternal !== undefined && !publicOnly && { isInternal }),
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
            ...(publicOnly && { priceSheet: PUBLIC_PRICE_SHEET_WHERE }),
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
        ...(publicOnly
          ? toStudyResponse(withoutProviderInfo(rest))
          : toStudyResponse(rest)),
        priceInfo: {
          ...toPriceInfo(regionalPrice),
          ...(!publicOnly && { hasConfiguredPrice: !!regionalPrice }),
        },
      };
    });

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string) {
    const study = await this.prisma.study.findFirst({
      where: { id, isActive: true },
      include: STUDY_PUBLIC_DETAIL_INCLUDE,
    });
    if (!study) throw studyNotFound(id);
    return this.toPublicStudyDetail(study);
  }

  async findAdminOne(id: string, user: BranchScopedUser) {
    const study = await this.findDetail({ id }, id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  private async toPublicStudyDetail(
    study: Prisma.StudyGetPayload<{
      include: typeof STUDY_PUBLIC_DETAIL_INCLUDE;
    }>,
  ) {
    const { priceSheetId, ...service } = study.service;
    const entry = priceSheetId
      ? await this.prisma.studyOnPriceSheet.findFirst({
          where: {
            studyId: study.id,
            priceSheetId,
            priceSheet: PUBLIC_PRICE_SHEET_WHERE,
          },
          select: { price: true, showPrice: true },
        })
      : null;

    return {
      ...toStudyResponse(withoutProviderInfo({ ...study, service })),
      priceInfo: toPriceInfo(entry),
    };
  }

  async findInactiveOne(id: string, user: BranchScopedUser) {
    const study = await this.findDetail({ id, isActive: false }, id);
    assertBranchAccess(user, study.branchId);
    return study;
  }

  async findBySlug(slug: string, branchId: string) {
    const study = await this.prisma.study.findUnique({
      where: { branchId_slug: { branchId, slug }, isActive: true },
      include: STUDY_PUBLIC_DETAIL_INCLUDE,
    });
    if (!study) {
      throw new NotFoundException(
        `Estudio con el slug '${slug}' no encontrado en esta sucursal`,
      );
    }
    return this.toPublicStudyDetail(study);
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
      select: { id: true, code: true, name: true, title: true, isPanel: true },
    });
    if (!study) throw studyNotFound(id);

    return {
      ...study,
      title: studyTitle(study),
      children: study.isPanel ? await loadPanelTree(this.prisma, study.id) : [],
    };
  }

  /**
   * Children rules of a panel (except cycles, checked when saving). `panelId`
   * is null for a panel that doesn't exist yet.
   */
  async assertValidPanelChildren(
    panelId: string | null,
    branchId: string,
    childIds: string[],
    db: StudyDb = this.prisma,
  ) {
    if (new Set(childIds).size !== childIds.length) {
      throw new BadRequestException('El perfil contiene estudios repetidos');
    }
    if (panelId && childIds.includes(panelId)) {
      throw new BadRequestException('Un perfil no puede contenerse a sí mismo');
    }

    const children = await db.study.findMany({
      where: { id: { in: childIds } },
      select: { id: true, code: true, branchId: true, isActive: true },
    });
    if (
      children.length !== childIds.length ||
      children.some((c) => c.branchId !== branchId)
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
  }

  /** With `tx`, runs inside the caller's transaction instead of its own. */
  async setPanelItems(
    id: string,
    dto: SetPanelItemsDto,
    user: BranchScopedUser,
    tx?: StudyDb,
  ) {
    const db = tx ?? this.prisma;
    const panel = await this.findAccessibleStudy(id, user, db);
    if (!panel.isPanel) {
      throw new BadRequestException(
        'Solo un estudio marcado como perfil (isPanel) puede tener estudios hijos',
      );
    }

    const childIds = dto.items.map((item) => item.childId);
    await this.assertValidPanelChildren(id, panel.branchId, childIds, db);

    const replaceItems = async (client: StudyDb) => {
      const graph = await loadPanelGraph(client, panel.branchId);
      graph.set(id, childIds);
      if (findPanelsInCycle(graph, [id]).length) {
        throw new BadRequestException(
          'La lista crea un ciclo: algún perfil hijo ya contiene (directa o indirectamente) a este perfil',
        );
      }

      await client.studyPanelItem.deleteMany({ where: { panelId: id } });
      await client.studyPanelItem.createMany({
        data: dto.items.map((item, index) => ({
          panelId: id,
          childId: item.childId,
          order: item.order ?? index,
        })),
      });
    };

    try {
      await (tx ? replaceItems(tx) : this.prisma.$transaction(replaceItems));
    } catch (error) {
      handleStudyDbErrors(error);
    }

    return db.studyPanelItem.findMany({
      where: { panelId: id },
      ...PANEL_ITEMS_INCLUDE,
    });
  }

  /**
   * Replaces all of a study's prices: sheets missing from `prices` lose theirs.
   * Same branch rules as `studyPrices` on create.
   */
  async replacePrices(
    studyId: string,
    prices: StudyPriceDto[],
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const study = await this.findAccessibleStudy(studyId, user, db);
    await this.assertPriceSheetsBelongToBranch(
      prices.map((p) => p.priceSheetId),
      study.branchId,
      db,
    );

    try {
      await db.studyOnPriceSheet.deleteMany({
        where: {
          studyId,
          priceSheetId: { notIn: prices.map((p) => p.priceSheetId) },
        },
      });
      for (const p of prices) {
        const values = {
          price: new Prisma.Decimal(p.price),
          showPrice: p.showPrice ?? true,
        };
        await db.studyOnPriceSheet.upsert({
          where: {
            studyId_priceSheetId: { studyId, priceSheetId: p.priceSheetId },
          },
          update: values,
          create: { ...values, studyId, priceSheetId: p.priceSheetId },
        });
      }
    } catch (error) {
      handleStudyDbErrors(error);
    }
  }

  /**
   * Business rules of an update (also used by ticket forms to validate a
   * requested change before applying it). Returns the current study.
   */
  async assertUpdatable(
    id: string,
    updateStudyDto: UpdateStudyDto,
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
    /** The caller removes the panel's children before un-marking it. */
    { childrenWillBeRemoved = false }: { childrenWillBeRemoved?: boolean } = {},
  ) {
    const {
      serviceId,
      sectionId,
      sampleTypeId,
      techniqueId,
      units,
      decimals,
      eligiblePatients,
      referenceValues,
      isPanel: isPanelInput,
      isActive,
    } = updateStudyDto;
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    const existingStudy = await this.findAccessibleStudy(id, user, db);

    const isPanel = isPanelInput ?? existingStudy.isPanel;
    this.assertPanelHasNoMeasurement(isPanel, {
      units,
      decimals,
      referenceValues,
    });
    this.assertValidProvider(
      updateStudyDto.isInternal ?? existingStudy.isInternal,
      updateStudyDto,
      existingStudy.providerName,
    );
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

    if (
      isPanelInput === false &&
      existingStudy.isPanel &&
      !childrenWillBeRemoved
    ) {
      const childCount = await db.studyPanelItem.count({
        where: { panelId: id },
      });
      if (childCount > 0) {
        throw new BadRequestException(
          `No se puede desmarcar como perfil: aún tiene ${childCount} estudio(s) hijo(s). Elimínalos primero.`,
        );
      }
    }

    if (isActive === false && existingStudy.isActive) {
      await this.assertNotInAnyPanel(id, db);
    }

    if (serviceId) {
      await this.assertServiceBelongsToBranch(
        serviceId,
        existingStudy.branchId,
        db,
      );
    }
    await this.assertCatalogsBelongToBranch(
      catalogIds,
      existingStudy.branchId,
      catalogIds,
      db,
    );

    return existingStudy;
  }

  async update(
    id: string,
    updateStudyDto: UpdateStudyDto,
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const {
      name,
      title,
      serviceId,
      sectionId,
      sampleTypeId,
      techniqueId,
      units,
      decimals,
      eligiblePatients,
      referenceValues,
      providerName,
      providerCost,
      slug: slugInput,
      ...studyData
    } = updateStudyDto;
    const slug = slugInput !== undefined ? toSlug(slugInput) : undefined;
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    const existingStudy = await this.assertUpdatable(
      id,
      updateStudyDto,
      user,
      db,
    );
    const isPanel = studyData.isPanel ?? existingStudy.isPanel;
    const isInternal = studyData.isInternal ?? existingStudy.isInternal;

    try {
      const study = await db.study.update({
        where: { id },
        data: {
          ...studyData,
          ...eligiblePatientsData(eligiblePatients),
          ...catalogRelations(catalogIds, 'update'),
          ...(isPanel ? { units: null, decimals: null } : { units, decimals }),
          ...providerData(isInternal, { providerName, providerCost }),
          ...(referenceValues && {
            referenceValues: {
              deleteMany: {},
              create: referenceValuesData(referenceValues),
            },
          }),
          ...(name && { name }),
          ...(title && { title }),
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
          title: true,
          slug: true,
          isActive: true,
          description: true,
          preparation: true,
          service: { select: { name: true } },
          section: { select: { name: true } },
          sampleType: { select: { name: true } },
          technique: { select: { name: true } },
          isPanel: true,
          panelItems: {
            orderBy: { order: 'asc' },
            select: { child: { select: { code: true } } },
          },
          parentPanels: {
            orderBy: { panel: { code: 'asc' } },
            select: { panel: { select: { code: true } } },
          },
          gender: true,
          ageFormat: true,
          minAge: true,
          maxAge: true,
          units: true,
          decimals: true,
          isInternal: true,
          providerName: true,
          providerCost: true,
          deliveryTime: true,
          createdAt: true,
          updatedAt: true,
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
      { header: 'Título', value: (s) => studyTitle(s) },
      { header: 'Slug', value: (s) => s.slug },
      { header: 'Activo', value: (s) => (s.isActive ? 'Sí' : 'No') },
      { header: 'Servicio', value: (s) => s.service.name },
      { header: 'Sección', value: (s) => s.section?.name ?? '' },
      { header: 'Tipo de muestra', value: (s) => s.sampleType?.name ?? '' },
      { header: 'Técnica', value: (s) => s.technique?.name ?? '' },
      { header: 'Es perfil', value: (s) => (s.isPanel ? 'Sí' : 'No') },
      {
        header: 'Parámetros',
        value: (s) => s.panelItems.map((i) => i.child.code).join(','),
      },
      {
        header: 'Forma parte de',
        value: (s) => s.parentPanels.map((p) => p.panel.code).join(','),
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
      { header: 'Interno', value: (s) => (s.isInternal ? 'Sí' : 'No') },
      { header: 'Maquilador', value: (s) => s.providerName ?? '' },
      {
        header: 'Costo maquilador',
        value: (s) => (s.providerCost !== null ? Number(s.providerCost) : ''),
      },
      {
        header: 'Tiempo de entrega (días)',
        value: (s) => s.deliveryTime ?? '',
      },
      { header: 'Descripción', value: (s) => s.description ?? '' },
      { header: 'Preparación', value: (s) => s.preparation ?? '' },
      ...priceColumns,
      {
        header: 'Creado',
        value: (s) => s.createdAt.toISOString().slice(0, 10),
      },
      {
        header: 'Actualizado',
        value: (s) => s.updatedAt.toISOString().slice(0, 10),
      },
    ];

    type ExportedReferenceValue = ExportedStudy['referenceValues'][number] & {
      studyCode: string;
      studyName: string;
      studyUnits: string | null;
    };
    const referenceColumns: Column<ExportedReferenceValue>[] = [
      { header: 'Código del estudio', value: (r) => r.studyCode },
      { header: 'Nombre del estudio', value: (r) => r.studyName },
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
      { header: 'Unidades', value: (r) => r.studyUnits ?? '' },
      { header: 'Texto', value: (r) => r.text ?? '' },
      {
        header: 'Fecha',
        value: (r) => r.date.toISOString().slice(0, 10),
      },
    ];
    const referenceValues = studies.flatMap((s) =>
      s.referenceValues.map((r) => ({
        ...r,
        studyCode: s.code,
        studyName: s.name,
        studyUnits: s.units,
      })),
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
