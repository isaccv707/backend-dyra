import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { StudiesService } from 'src/studies/studies.service';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import {
  ApplyNewPanelChildDto,
  ApplyStudyCreateFormDto,
} from './apply-study-create-form.dto';
import {
  StudyCreateFormChildDto,
  StudyCreateFormDto,
} from './study-create-form.dto';

@Injectable()
export class StudyCreateFormHandler implements TicketFormHandler<
  StudyCreateFormDto,
  ApplyStudyCreateFormDto
> {
  private readonly logger = new Logger(StudyCreateFormHandler.name);

  readonly type = 'STUDY_CREATE' as const;
  readonly dataDto = StudyCreateFormDto;
  readonly applyDto = ApplyStudyCreateFormDto;

  constructor(
    private readonly prisma: PrismaService,
    private readonly studiesService: StudiesService,
  ) {}

  async assertValid(data: StudyCreateFormDto, { branchId }: TicketFormContext) {
    if (data.isPanel && data.decimals !== undefined && data.decimals !== null) {
      throw new BadRequestException(
        'decimals no aplica a un perfil (isPanel = true)',
      );
    }

    await this.assertStudyFieldsValid(data, branchId);
    await this.assertPricesCoverActivePriceSheets(data.prices, branchId);
    await this.assertPanelItemsValid(data, branchId);
  }

  async apply(
    data: StudyCreateFormDto,
    applyData: ApplyStudyCreateFormDto,
    context: TicketFormContext,
  ): Promise<TicketFormApplyResult> {
    await this.assertValid(data, context);

    const { newStudies = [], ...studyApply } = applyData;
    const { prices, decimals, panelItems = [], ...studyData } = data;
    const newChildren = panelItems.flatMap((item) =>
      item.newStudy ? [item.newStudy] : [],
    );

    if (newStudies.length !== newChildren.length) {
      throw new BadRequestException(
        `Captura en newStudies los datos de TI (code, etc.) de los ${newChildren.length} parámetro(s) nuevo(s) del perfil, en el mismo orden en que aparecen en panelItems`,
      );
    }
    await this.assertCodesAvailable(
      [studyApply.code, ...newStudies.map((c) => c.code)],
      context.branchId,
    );

    const createdIds: string[] = [];
    try {
      const study = await this.studiesService.create({
        ...studyData,
        ...studyApply,
        ...(!data.isPanel && { decimals }),
        branchId: context.branchId,
        studyPrices: prices.map((p) => ({
          priceSheetId: p.priceSheetId,
          price: p.price,
          showPrice: true,
        })),
      });
      if (!study) {
        throw new BadRequestException('No se pudo crear el parámetro');
      }
      createdIds.push(study.id);

      if (panelItems.length === 0) {
        return {
          result: { studyId: study.id, code: study.code, name: study.name },
          summary: `creó el parámetro ${study.code} - ${study.name}`,
        };
      }

      const childIds: string[] = [];
      let newIndex = 0;
      for (const item of panelItems) {
        if (item.studyId) {
          childIds.push(item.studyId);
          continue;
        }
        const child = await this.createPanelChild(
          item.newStudy!,
          newStudies[newIndex++],
          studyApply.serviceId,
          context.branchId,
        );
        createdIds.push(child.id);
        childIds.push(child.id);
      }

      await this.studiesService.setPanelItems(study.id, {
        items: childIds.map((childId) => ({ childId })),
      });

      const children = await this.prisma.study.findMany({
        where: { id: { in: childIds } },
        select: { id: true, code: true, name: true },
      });
      const childById = new Map(children.map((c) => [c.id, c]));
      const newCodes = newStudies.map((c) => c.code);

      return {
        result: {
          studyId: study.id,
          code: study.code,
          name: study.name,
          panelItems: childIds.map((id) => ({
            studyId: id,
            code: childById.get(id)?.code ?? null,
            name: childById.get(id)?.name ?? null,
            isNew: createdIds.includes(id),
          })),
        },
        summary:
          `creó el perfil ${study.code} - ${study.name} con ${childIds.length} parámetro(s)` +
          (newCodes.length ? ` (nuevos: ${newCodes.join(', ')})` : ''),
      };
    } catch (error) {
      await this.rollback(createdIds);
      throw error;
    }
  }

  private async createPanelChild(
    child: StudyCreateFormChildDto,
    childApply: ApplyNewPanelChildDto,
    panelServiceId: string,
    branchId: string,
  ) {
    const created = await this.studiesService.create({
      ...child,
      ...childApply,
      serviceId: childApply.serviceId ?? panelServiceId,
      isPanel: false,
      isOrderable: false,
      branchId,
    });
    if (!created) {
      throw new BadRequestException(
        `No se pudo crear el parámetro ${childApply.code}`,
      );
    }
    return created;
  }

  private async rollback(createdIds: string[]) {
    for (const id of [...createdIds].reverse()) {
      try {
        await this.studiesService.remove(id);
      } catch (error) {
        this.logger.error(
          `No se pudo revertir el estudio ${id} tras un fallo al aprobar el formulario: ${(error as Error).message}`,
        );
      }
    }
  }

  private async assertStudyFieldsValid(
    study: Pick<
      StudyCreateFormChildDto,
      'minAge' | 'maxAge' | 'sectionId' | 'sampleTypeId' | 'techniqueId'
    >,
    branchId: string,
  ) {
    this.studiesService.assertValidAgeRange(study.minAge, study.maxAge);
    await this.studiesService.assertCatalogsBelongToBranch(
      {
        sectionId: study.sectionId,
        sampleTypeId: study.sampleTypeId,
        techniqueId: study.techniqueId,
      },
      branchId,
    );
  }

  private async assertPanelItemsValid(
    data: StudyCreateFormDto,
    branchId: string,
  ) {
    if (!data.panelItems) return;

    if (!data.isPanel) {
      throw new BadRequestException(
        'panelItems solo aplica cuando isPanel = true',
      );
    }

    data.panelItems.forEach((item, index) => {
      if (!item.studyId === !item.newStudy) {
        throw new BadRequestException(
          `panelItems.${index}: indica studyId (parámetro existente) o newStudy (parámetro nuevo), solo uno`,
        );
      }
    });

    const existingIds = data.panelItems.flatMap((item) =>
      item.studyId ? [item.studyId] : [],
    );
    if (new Set(existingIds).size !== existingIds.length) {
      throw new BadRequestException('El perfil contiene estudios repetidos');
    }
    if (existingIds.length > 0) {
      const found = await this.prisma.study.count({
        where: { id: { in: existingIds }, branchId },
      });
      if (found !== existingIds.length) {
        throw new BadRequestException(
          'Todos los parámetros existentes del perfil deben existir y pertenecer a la sucursal del ticket',
        );
      }
    }

    for (const item of data.panelItems) {
      if (item.newStudy) {
        await this.assertStudyFieldsValid(item.newStudy, branchId);
      }
    }
  }

  private async assertCodesAvailable(codes: string[], branchId: string) {
    const repeated = codes.filter((code, i) => codes.indexOf(code) !== i);
    if (repeated.length > 0) {
      throw new BadRequestException(
        `Códigos repetidos en la solicitud: ${[...new Set(repeated)].join(', ')}`,
      );
    }

    const taken = await this.prisma.study.findMany({
      where: { branchId, code: { in: codes } },
      select: { code: true },
    });
    if (taken.length > 0) {
      throw new ConflictException(
        `Ya existen estudios con el código: ${taken.map((s) => s.code).join(', ')}`,
      );
    }
  }

  private async assertPricesCoverActivePriceSheets(
    prices: StudyCreateFormDto['prices'],
    branchId: string,
  ) {
    const providedIds = prices.map((p) => p.priceSheetId);
    if (new Set(providedIds).size !== providedIds.length) {
      throw new BadRequestException(
        'Hay tarifarios repetidos en la lista de precios',
      );
    }

    const activeSheets = await this.prisma.priceSheets.findMany({
      where: { branchId, isActive: true },
      select: { id: true, name: true },
    });
    const activeIds = new Set(activeSheets.map((s) => s.id));

    if (providedIds.some((id) => !activeIds.has(id))) {
      throw new BadRequestException(
        'Todos los precios deben ser de tarifarios activos de la sucursal del ticket',
      );
    }

    const missing = activeSheets.filter((s) => !providedIds.includes(s.id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Falta el precio para los tarifarios: ${missing.map((s) => s.name).join(', ')}`,
      );
    }
  }
}
