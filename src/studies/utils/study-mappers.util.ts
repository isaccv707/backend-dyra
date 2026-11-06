import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { generateSlug } from 'src/common/utils/slugger.util';
import {
  STUDY_DEFAULT_MAX_AGE,
  STUDY_DEFAULT_MIN_AGE,
} from '../constants/study-fields.const';
import { CreateReferenceValueDto } from '../dto/reference-value.dto';
import { EligiblePatientsDto } from '../dto/eligible-patients.dto';
import { studyTitle } from './study-title.util';

type StudyResponseColumns = {
  name: string;
  title: string | null;
  gender: string;
  ageFormat: string;
  minAge: number;
  maxAge: number;
};

type StudyProviderColumns = {
  isInternal: boolean;
  providerId: string | null;
  providerCost: Prisma.Decimal | null;
  provider?: unknown;
};

const NO_PUBLIC_PRICE_MESSAGE = 'Para mayor información consulte en sucursal';

export const isSet = <T>(value: T | null | undefined): value is T =>
  value !== undefined && value !== null;

export const studyNotFound = (id: string) =>
  new NotFoundException(`Estudio con el ID ${id} no encontrado`);

export function toSlug(value: string) {
  const slug = generateSlug(value);
  if (!slug) {
    throw new BadRequestException(
      'El slug no puede quedar vacío: usa letras o números',
    );
  }
  return slug;
}

export function handleStudyDbErrors(
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

export function eligiblePatientsData(eligiblePatients?: EligiblePatientsDto) {
  return {
    gender: eligiblePatients?.gender,
    ageFormat: eligiblePatients?.ageFormat,
    minAge: eligiblePatients?.minAge,
    maxAge: eligiblePatients?.maxAge,
  };
}

export function toStudyResponse<T extends StudyResponseColumns>(study: T) {
  const { gender, ageFormat, minAge, maxAge, ...rest } = study;
  return {
    ...rest,
    title: studyTitle(study),
    eligiblePatients: { gender, ageFormat, minAge, maxAge },
  };
}

/** Public responses never reveal that a study is outsourced, to whom or at what cost. */
export function withoutProviderInfo<T extends StudyProviderColumns>(study: T) {
  const {
    isInternal: _isInternal,
    providerId: _providerId,
    providerCost: _providerCost,
    provider: _provider,
    ...rest
  } = study;
  return rest;
}

/** An internal study never keeps provider data. */
export function providerCostData(
  isInternal: boolean,
  providerCost: number | null | undefined,
) {
  if (isInternal) return { providerCost: null };
  return {
    providerCost: isSet(providerCost)
      ? new Prisma.Decimal(providerCost)
      : providerCost,
  };
}

export function providerRelation(
  isInternal: boolean,
  providerId: string | undefined,
  mode: 'create' | 'update',
) {
  if (isInternal) {
    return mode === 'update' ? { provider: { disconnect: true } } : {};
  }
  return providerId ? { provider: { connect: { id: providerId } } } : {};
}

export function referenceValuesData(
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

export type StudyCatalogIds = {
  sectionId?: number | null;
  sampleTypeId?: number | null;
  techniqueId?: number | null;
};

export function catalogRelations(
  ids: StudyCatalogIds,
  mode: 'create' | 'update',
) {
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

export function toPriceInfo(
  entry: { price: Prisma.Decimal; showPrice: boolean } | null | undefined,
) {
  return {
    showPrice: entry?.showPrice ?? false,
    price: entry?.showPrice ? entry.price : null,
    message: entry?.showPrice ? null : NO_PUBLIC_PRICE_MESSAGE,
  };
}
