import { BadRequestException, Injectable } from '@nestjs/common';
import { StudiesService } from 'src/studies/studies.service';
import { ApplyStudyCreateFormDto } from '../dto/apply-study-form.dto';
import { StudyCreateFormDto } from '../dto/study-create-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';
import {
  assertIdentitiesMatch,
  assertPanelItemsAllowed,
  assertValidPanelItems,
  createPanelChildren,
} from './study-form-panel.util';

const kindLabel = (isPanel?: boolean) => (isPanel ? 'perfil' : 'parámetro');

@Injectable()
export class StudyCreateFormHandler implements TicketFormHandler<
  StudyCreateFormDto,
  ApplyStudyCreateFormDto
> {
  readonly type = 'STUDY_CREATE' as const;
  readonly dataDto = StudyCreateFormDto;
  readonly applyDto = ApplyStudyCreateFormDto;

  constructor(private readonly studies: StudiesService) {}

  async validate(
    data: StudyCreateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const { panelItems, ...study } = data;
    assertPanelItemsAllowed(!!study.isPanel, panelItems);
    if (study.isPanel && !panelItems?.length) {
      throw new BadRequestException(
        'form.panelItems: un perfil debe incluir al menos un estudio',
      );
    }

    await this.studies.assertCreatable(
      { ...study, branchId: context.branchId },
      db,
    );
    if (panelItems?.length) {
      await assertValidPanelItems(this.studies, null, panelItems, context, db);
    }

    return {
      title: ticketTitle(`Alta de ${kindLabel(study.isPanel)}`, study.name),
    };
  }

  async apply(
    data: StudyCreateFormDto,
    applyData: ApplyStudyCreateFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    await this.validate(data, context, tx);
    const { panelItems, ...study } = data;
    const { newStudies, ...identity } = applyData;
    assertIdentitiesMatch(panelItems, newStudies);

    const { childIds, created } = await createPanelChildren(
      this.studies,
      panelItems ?? [],
      newStudies,
      context,
      tx,
    );

    const createdStudy = await this.studies.create(
      { ...study, ...identity, branchId: context.branchId },
      context.actor,
      tx,
    );
    if (!createdStudy) {
      throw new BadRequestException('No se pudo crear el estudio');
    }

    if (study.isPanel) {
      await this.studies.setPanelItems(
        createdStudy.id,
        { items: childIds.map((childId) => ({ childId })) },
        context.actor,
        tx,
      );
    }

    const childrenNote = created.length
      ? ` con ${created.length} parámetro(s) nuevo(s): ${created.map((c) => c.code).join(', ')}`
      : '';

    return {
      result: {
        studyId: createdStudy.id,
        code: createdStudy.code,
        name: createdStudy.name,
        createdChildren: created,
      },
      summary: `creó el ${kindLabel(study.isPanel)} ${createdStudy.code} (${createdStudy.name})${childrenNote}`,
    };
  }
}
