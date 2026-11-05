import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import {
  STUDY_CATALOGS,
  StudyCatalogKind,
} from 'src/study-catalogs/study-catalog.config';
import { studyCatalogDelegate } from 'src/study-catalogs/utils/study-catalog.util';
import {
  STUDY_DEFAULT_MAX_AGE,
  STUDY_DEFAULT_MIN_AGE,
} from '../constants/study-fields.const';
import { CreateStudyDto } from '../dto/create-study.dto';
import { CreateReferenceValueDto } from '../dto/reference-value.dto';
import { UpdateStudyDto } from '../dto/update-study.dto';
import { StudyDb } from '../types/study-db.type';
import {
  isSet,
  StudyCatalogIds,
  studyNotFound,
} from '../utils/study-mappers.util';

const REFERENCE_VALUE_RANGE_FIELDS = [
  'gender',
  'unitAge',
  'minAge',
  'maxAge',
  'minValue',
  'maxValue',
] as const satisfies ReadonlyArray<keyof CreateReferenceValueDto>;

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

const CATALOG_ID_FIELDS: Array<[keyof StudyCatalogIds, StudyCatalogKind]> = [
  ['sectionId', 'section'],
  ['sampleTypeId', 'sampleType'],
  ['techniqueId', 'technique'],
];

export type CreatableStudyDto = Pick<
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
  | 'providerId'
  | 'providerCost'
  | 'eligiblePatients'
  | 'referenceValues'
  | 'studyPrices'
>;

/** Business rules of studies; also the access check shared by every write. */
@Injectable()
export class StudyValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAccessibleStudy(
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

  async assertNotInAnyPanel(id: string, db: StudyDb = this.prisma) {
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

  /** `storedProviderId` is the current value when updating. */
  private assertValidProvider(
    isInternal: boolean,
    {
      providerId,
      providerCost,
    }: { providerId?: string | null; providerCost?: number | null },
    storedProviderId: string | null = null,
  ) {
    if (isInternal) {
      const invalid = [
        ...(isSet(providerId) ? ['providerId'] : []),
        ...(isSet(providerCost) ? ['providerCost'] : []),
      ];
      if (invalid.length) {
        throw new BadRequestException(
          `Un estudio interno (isInternal = true) no puede tener ${invalid.join(' ni ')}: solo aplican a estudios maquilados`,
        );
      }
      return;
    }
    if (!(providerId ?? storedProviderId)) {
      throw new BadRequestException(
        'Un estudio maquilado (isInternal = false) requiere providerId (maquilador)',
      );
    }
  }

  /** Each provider must exist, be of the study's branch and be active. */
  async assertProvidersBelongToBranch(
    providerIds: string[],
    branchId: string,
    db: StudyDb = this.prisma,
  ) {
    const ids = [...new Set(providerIds)];
    if (!ids.length) return;
    const providers = await db.studyProvider.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, branchId: true, isActive: true },
    });
    for (const id of ids) {
      const provider = providers.find((p) => p.id === id);
      if (!provider) {
        throw new NotFoundException(`No existe el maquilador con el ID ${id}`);
      }
      if (provider.branchId !== branchId) {
        throw new BadRequestException(
          'El maquilador seleccionado pertenece a otra sucursal',
        );
      }
      if (!provider.isActive) {
        throw new BadRequestException(
          `El maquilador "${provider.name}" está inactivo`,
        );
      }
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
      dto: CreatableStudyDto;
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

    await this.assertProvidersBelongToBranch(
      unique(
        items.map((i) =>
          i.dto.isInternal === false ? i.dto.providerId : undefined,
        ),
      ),
      branchId,
      db,
    );

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
   * Business rules of a new study that don't depend on its code/slug. Also used
   * by ticket forms to validate a requested study before it's created.
   */
  async assertCreatable(dto: CreatableStudyDto, db: StudyDb = this.prisma) {
    const { branchId, eligiblePatients, referenceValues, studyPrices } = dto;
    const catalogIds = {
      sectionId: dto.sectionId,
      sampleTypeId: dto.sampleTypeId,
      techniqueId: dto.techniqueId,
    };

    this.assertPanelHasNoMeasurement(dto.isPanel ?? false, dto);
    this.assertValidProvider(dto.isInternal ?? true, dto);
    if (dto.isInternal === false && dto.providerId) {
      await this.assertProvidersBelongToBranch([dto.providerId], branchId, db);
    }
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
      existingStudy.providerId,
    );
    if (
      updateStudyDto.providerId &&
      !(updateStudyDto.isInternal ?? existingStudy.isInternal) &&
      updateStudyDto.providerId !== existingStudy.providerId
    ) {
      await this.assertProvidersBelongToBranch(
        [updateStudyDto.providerId],
        existingStudy.branchId,
        db,
      );
    }
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
}
