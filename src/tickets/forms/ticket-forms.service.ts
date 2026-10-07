import { Injectable } from '@nestjs/common';
import { Prisma, TicketFormType } from '@prisma/client';
import { instanceToPlain } from 'class-transformer';
import { StudyCreateFormHandler } from './study-create/study-create-form.handler';
import { StudyUpdateFormHandler } from './study-update/study-update-form.handler';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormHandler,
} from './ticket-form-handler.interface';
import { validateFormPayload } from './validate-form-payload.util';

@Injectable()
export class TicketFormsService {
  private readonly handlers: Record<
    TicketFormType,
    TicketFormHandler<object, object>
  >;

  constructor(
    studyCreate: StudyCreateFormHandler,
    studyUpdate: StudyUpdateFormHandler,
  ) {
    this.handlers = { STUDY_CREATE: studyCreate, STUDY_UPDATE: studyUpdate };
  }

  async parseData(
    type: TicketFormType,
    payload: unknown,
    context: TicketFormContext,
    path = '',
  ): Promise<Prisma.InputJsonObject> {
    const handler = this.handlers[type];
    const data = await validateFormPayload(handler.dataDto, payload, path);
    await handler.assertValid(data, context);
    return instanceToPlain(data) as Prisma.InputJsonObject;
  }

  async apply(
    type: TicketFormType,
    storedData: Prisma.JsonValue,
    applyPayload: unknown,
    context: TicketFormContext,
  ): Promise<TicketFormApplyResult> {
    const handler = this.handlers[type];
    const data = await validateFormPayload(handler.dataDto, storedData, 'form');
    const applyData = await validateFormPayload(handler.applyDto, applyPayload);
    return handler.apply(data, applyData, context);
  }
}
