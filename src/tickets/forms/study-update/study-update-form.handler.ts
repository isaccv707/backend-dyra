import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Study } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudiesService } from 'src/studies/studies.service';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ApplyStudyUpdateFormDto } from './apply-study-update-form.dto';
import { StudyUpdateFormDto } from './study-update-form.dto';

const STUDY_FIELD_LABELS = {
  name: 'nombre',
  sectionId: 'sección',
  sampleTypeId: 'tipo de muestra',
  techniqueId: 'técnica',
  isPanel: 'perfil',
  gender: 'género',
  ageFormat: 'formato de edad',
  minAge: 'edad mínima',
  maxAge: 'edad máxima',
  decimals: 'decimales',
  units: 'unidades',
  code: 'código',
  serviceId: 'servicio',
  title: 'título',
  abbreviation: 'abreviatura',
  description: 'descripción',
  deliveryTime: 'tiempo de entrega',
  preparation: 'preparación',
  isOrderable: 'ordenable',
} satisfies Partial<Record<keyof Study, string>>;

type StudyField = keyof typeof STUDY_FIELD_LABELS;

const NULLABLE_FIELDS: string[] = ['units'];

type StudyChanges = Partial<
  Record<StudyField, { from: Prisma.JsonValue; to: Prisma.JsonValue }>
>;

type PriceChanges = Record<
  string,
  { priceSheet: string; from: number | null; to: number }
>;

@Injectable()
export class StudyUpdateFormHandler implements TicketFormHandler<
  StudyUpdateFormDto,
  ApplyStudyUpdateFormDto
> {
  readonly type = 'STUDY_UPDATE' as const;
  readonly dataDto = StudyUpdateFormDto;
  readonly applyDto = ApplyStudyUpdateFormDto;

  constructor(
    private readonly prisma: PrismaService,
    private readonly studiesService: StudiesService,
  ) {}

  async assertValid(data: StudyUpdateFormDto, context: TicketFormContext) {
    const { study, priceChanges } = await this.validateAgainstStudy(
      data,
      context,
    );
    const { studyId: _studyId, prices: _prices, ...fields } = data;

    if (
      Object.keys(this.diff(study, fields)).length === 0 &&
      Object.keys(priceChanges).length === 0
    ) {
      throw new BadRequestException(
        'Indica al menos un campo o precio con un valor distinto al actual del parámetro',
      );
    }
  }

  async apply(
    data: StudyUpdateFormDto,
    applyData: ApplyStudyUpdateFormDto,
    context: TicketFormContext,
  ): Promise<TicketFormApplyResult> {
    this.assertNoForbiddenNulls(applyData);
    const { study, priceChanges } = await this.validateAgainstStudy(
      data,
      context,
    );
    const { studyId, prices: _prices, ...fields } = data;
    const changes = this.diff(study, { ...fields, ...applyData });

    if (
      Object.keys(changes).length === 0 &&
      Object.keys(priceChanges).length === 0
    ) {
      throw new BadRequestException(
        'El parámetro ya tiene los valores solicitados: no hay nada que actualizar',
      );
    }

    let { code, name } = study;
    if (Object.keys(changes).length > 0) {
      const updated = await this.studiesService.update(
        studyId,
        Object.fromEntries(
          Object.entries(changes).map(([field, change]) => [field, change.to]),
        ),
      );
      if (!updated) {
        throw new BadRequestException('No se pudo actualizar el parámetro');
      }
      ({ code, name } = updated);
    }

    if (Object.keys(priceChanges).length > 0) {
      await this.prisma.$transaction(
        Object.entries(priceChanges).map(([priceSheetId, change]) =>
          this.prisma.studyOnPriceSheet.upsert({
            where: { studyId_priceSheetId: { studyId, priceSheetId } },
            update: { price: new Prisma.Decimal(change.to) },
            create: {
              studyId,
              priceSheetId,
              price: new Prisma.Decimal(change.to),
            },
          }),
        ),
      );
    }

    const labels = [
      ...(Object.keys(changes) as StudyField[]).map(
        (field) => STUDY_FIELD_LABELS[field],
      ),
      ...(Object.keys(priceChanges).length > 0
        ? [
            `precios: ${Object.values(priceChanges)
              .map((c) => c.priceSheet)
              .join(', ')}`,
          ]
        : []),
    ];

    return {
      result: { studyId, code, name, changes, priceChanges },
      summary: `actualizó el parámetro ${code} - ${name} (${labels.join('; ')})`,
    };
  }

  private async validateAgainstStudy(
    data: StudyUpdateFormDto,
    { branchId }: TicketFormContext,
  ) {
    this.assertNoForbiddenNulls(data);
    const study = await this.findStudyInBranch(data.studyId, branchId);

    if (
      (data.isPanel ?? study.isPanel) &&
      data.decimals !== undefined &&
      data.decimals !== null
    ) {
      throw new BadRequestException(
        'decimals no aplica a un perfil (isPanel = true)',
      );
    }

    this.studiesService.assertValidAgeRange(
      data.minAge ?? study.minAge,
      data.maxAge ?? study.maxAge,
    );
    await this.studiesService.assertCatalogsBelongToBranch(
      {
        sectionId: data.sectionId,
        sampleTypeId: data.sampleTypeId,
        techniqueId: data.techniqueId,
      },
      branchId,
    );

    const priceChanges = await this.diffPrices(study, data.prices, branchId);
    return { study, priceChanges };
  }

  private async findStudyInBranch(studyId: string, branchId: string) {
    const study = await this.prisma.study.findUnique({
      where: { id: studyId },
    });
    if (!study) {
      throw new NotFoundException(`Study with id ${studyId} not found`);
    }
    if (study.branchId !== branchId) {
      throw new BadRequestException(
        'El parámetro pertenece a otra sucursal distinta a la del ticket',
      );
    }
    return study;
  }

  private assertNoForbiddenNulls(fields: object) {
    const nulls = Object.entries(fields)
      .filter(
        ([field, value]) => value === null && !NULLABLE_FIELDS.includes(field),
      )
      .map(([field]) => field);

    if (nulls.length > 0) {
      throw new BadRequestException(
        `Estos campos no pueden ser null: ${nulls.join(', ')}`,
      );
    }
  }

  private diff(study: Study, requested: object): StudyChanges {
    const changes: StudyChanges = {};

    for (const [field, value] of Object.entries(requested)) {
      if (value === undefined || !(field in STUDY_FIELD_LABELS)) continue;

      const current = study[field as StudyField] ?? null;
      if (current !== value) {
        changes[field as StudyField] = {
          from: current,
          to: value as Prisma.JsonValue,
        };
      }
    }

    return changes;
  }

  private async diffPrices(
    study: Study,
    prices: StudyUpdateFormDto['prices'],
    branchId: string,
  ): Promise<PriceChanges> {
    if (!prices?.length) return {};

    const sheetIds = prices.map((p) => p.priceSheetId);
    if (new Set(sheetIds).size !== sheetIds.length) {
      throw new BadRequestException(
        'Hay tarifarios repetidos en la lista de precios',
      );
    }

    const [sheets, current] = await Promise.all([
      this.prisma.priceSheets.findMany({
        where: { id: { in: sheetIds }, branchId, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.studyOnPriceSheet.findMany({
        where: { studyId: study.id, priceSheetId: { in: sheetIds } },
        select: { priceSheetId: true, price: true },
      }),
    ]);

    if (sheets.length !== sheetIds.length) {
      throw new BadRequestException(
        'Todos los precios deben ser de tarifarios activos de la sucursal del ticket',
      );
    }

    const sheetNames = new Map(sheets.map((s) => [s.id, s.name]));
    const currentPrices = new Map(
      current.map((c) => [c.priceSheetId, Number(c.price)]),
    );

    const changes: PriceChanges = {};
    for (const { priceSheetId, price } of prices) {
      const from = currentPrices.get(priceSheetId) ?? null;
      if (from !== price) {
        changes[priceSheetId] = {
          priceSheet: sheetNames.get(priceSheetId)!,
          from,
          to: price,
        };
      }
    }

    return changes;
  }
}
