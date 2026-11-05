import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
} from 'src/common/utils/branch-access.util';
import { toTitleCase } from 'src/common/utils/title-case.util';
import { STUDY_WRITE_INCLUDE } from '../constants/study-includes.const';
import { CreateStudyDto } from '../dto/create-study.dto';
import { UpdateStudyDto } from '../dto/update-study.dto';
import { StudyDb } from '../types/study-db.type';
import {
  catalogRelations,
  eligiblePatientsData,
  handleStudyDbErrors,
  providerCostData,
  providerRelation,
  referenceValuesData,
  toSlug,
  toStudyResponse,
} from '../utils/study-mappers.util';
import { StudyValidationService } from './study-validation.service';

/** Creates, updates and deactivates studies. */
@Injectable()
export class StudyWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: StudyValidationService,
  ) {}

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
    await this.validation.assertCreatableMany(items, branchId, db);

    const rows = items.map(({ dto }) => {
      const name = toTitleCase(dto.name);
      return {
        id: randomUUID(),
        dto: { ...dto, name },
        slug: toSlug(dto.slug ?? name),
      };
    });

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
            providerId: (dto.isInternal ?? true) ? null : dto.providerId,
            ...providerCostData(dto.isInternal ?? true, dto.providerCost),
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

  async create(
    createStudyDto: CreateStudyDto,
    user: BranchScopedUser,
    db: StudyDb = this.prisma,
  ) {
    const {
      name: nameInput,
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
      providerId,
      providerCost,
      slug: slugInput,
      ...studyData
    } = createStudyDto;
    assertBranchAccess(user, branchId);
    const name = toTitleCase(nameInput);
    const slug = toSlug(slugInput ?? name);
    const catalogIds = { sectionId, sampleTypeId, techniqueId };
    const isPanel = studyData.isPanel ?? false;
    const isInternal = studyData.isInternal ?? true;

    await this.validation.assertCreatable(createStudyDto, db);

    try {
      const study = await db.study.create({
        data: {
          ...studyData,
          ...eligiblePatientsData(eligiblePatients),
          ...catalogRelations(catalogIds, 'create'),
          units: isPanel ? null : units,
          decimals: isPanel ? null : decimals,
          ...providerRelation(isInternal, providerId, 'create'),
          ...providerCostData(isInternal, providerCost),
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
      providerId,
      providerCost,
      slug: slugInput,
      ...studyData
    } = updateStudyDto;
    const slug = slugInput !== undefined ? toSlug(slugInput) : undefined;
    const catalogIds = { sectionId, sampleTypeId, techniqueId };

    const existingStudy = await this.validation.assertUpdatable(
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
          ...providerRelation(isInternal, providerId, 'update'),
          ...providerCostData(isInternal, providerCost),
          ...(referenceValues && {
            referenceValues: {
              deleteMany: {},
              create: referenceValuesData(referenceValues),
            },
          }),
          ...(name && { name: toTitleCase(name) }),
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

  async remove(id: string, user: BranchScopedUser) {
    await this.validation.findAccessibleStudy(id, user);
    await this.validation.assertNotInAnyPanel(id);

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
