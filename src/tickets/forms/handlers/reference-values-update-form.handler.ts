import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ApplyReferenceValuesUpdateFormDto,
  ReferenceValuesUpdateFormDto,
} from '../dto/reference-values-update-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';
import { StudyUpdateFormHandler } from './study-update-form.handler';

/**
 * A STUDY_UPDATE that only replaces the reference values: same checks (a
 * panel has none, the list didn't change since the request) and same
 * before/after in the result.
 */
@Injectable()
export class ReferenceValuesUpdateFormHandler implements TicketFormHandler<
  ReferenceValuesUpdateFormDto,
  ApplyReferenceValuesUpdateFormDto
> {
  readonly type = 'REFERENCE_VALUES_UPDATE' as const;
  readonly dataDto = ReferenceValuesUpdateFormDto;
  readonly applyDto = ApplyReferenceValuesUpdateFormDto;

  constructor(private readonly studyUpdate: StudyUpdateFormHandler) {}

  async validate(
    data: ReferenceValuesUpdateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const validation = await this.studyUpdate.validate(data, context, db);
    const study = await db.study.findUniqueOrThrow({
      where: { id: data.studyId },
      select: { code: true, name: true, isPanel: true },
    });
    if (study.isPanel) {
      throw new BadRequestException(
        'form.studyId: un perfil no tiene valores de referencia; elige uno de sus parámetros',
      );
    }
    return {
      ...validation,
      title: ticketTitle(
        'Valores de referencia',
        `${study.code} ${study.name}`,
      ),
    };
  }

  async apply(
    data: ReferenceValuesUpdateFormDto,
    _applyData: ApplyReferenceValuesUpdateFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    const applied = await this.studyUpdate.apply(data, {}, context, tx);
    const code = (applied.result as { code?: string }).code;
    return {
      ...applied,
      summary: `actualizó los valores de referencia del parámetro ${code}`,
    };
  }
}
