import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, TicketFormType } from '@prisma/client';
import { instanceToPlain } from 'class-transformer';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { AccessRequestFormHandler } from './handlers/access-request-form.handler';
import { ClientCreateFormHandler } from './handlers/client-create-form.handler';
import { ReferenceValuesUpdateFormHandler } from './handlers/reference-values-update-form.handler';
import { SoftwareRemoteFormHandler } from './handlers/software-remote-form.handler';
import { StudyCreateFormHandler } from './handlers/study-create-form.handler';
import { StudyUpdateFormHandler } from './handlers/study-update-form.handler';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from './ticket-form-handler.interface';
import { validateFormPayload } from './validate-form-payload.util';
import {
  TICKET_FORM_DEFINITIONS,
  TICKET_FORM_UPGRADES,
} from './ticket-forms.const';

@Injectable()
export class TicketFormsService {
  private readonly handlers: Record<TicketFormType, TicketFormHandler>;

  constructor(
    private readonly prisma: PrismaService,
    softwareRemote: SoftwareRemoteFormHandler,
    accessRequest: AccessRequestFormHandler,
    studyCreate: StudyCreateFormHandler,
    studyUpdate: StudyUpdateFormHandler,
    clientCreate: ClientCreateFormHandler,
    referenceValuesUpdate: ReferenceValuesUpdateFormHandler,
  ) {
    this.handlers = {
      SOFTWARE_REMOTE: softwareRemote,
      ACCESS_REQUEST: accessRequest,
      STUDY_CREATE: studyCreate,
      STUDY_UPDATE: studyUpdate,
      CLIENT_CREATE: clientCreate,
      REFERENCE_VALUES_UPDATE: referenceValuesUpdate,
    } as Record<TicketFormType, TicketFormHandler>;
  }

  isApplicable(type: TicketFormType) {
    return !!this.handlers[type].apply;
  }

  /**
   * Brings data saved with an older form version to the current shape, or
   * asks to edit the request when there's no automatic upgrade.
   */
  upgrade(
    type: TicketFormType,
    version: number,
    data: Prisma.JsonValue,
  ): Prisma.JsonValue {
    const current = TICKET_FORM_DEFINITIONS[type].version;
    let upgraded = data as Record<string, unknown>;
    for (let from = version; from < current; from++) {
      const step = TICKET_FORM_UPGRADES[type]?.[from];
      if (!step) {
        throw new ConflictException(
          `El formulario se guardó con un formato anterior (versión ${version}): edítalo para actualizarlo antes de aprobarlo`,
        );
      }
      upgraded = step(upgraded);
    }
    return upgraded as Prisma.JsonValue;
  }

  /** Validates a requester's payload; returns the JSON to store and the generated title. */
  async parse(
    type: TicketFormType,
    payload: unknown,
    context: TicketFormContext,
    db: TicketFormDb = this.prisma,
  ) {
    const handler = this.handlers[type];
    const data = await validateFormPayload(handler.dataDto, payload, 'form');
    const validation = await handler.validate(data, context, db);
    return {
      data: {
        ...(instanceToPlain(data) as Prisma.InputJsonObject),
        ...validation.data,
      },
      title: validation.title,
    };
  }

  /** Runs the requested action inside `tx`; the stored data is validated again. */
  async apply(
    type: TicketFormType,
    storedData: Prisma.JsonValue,
    applyPayload: unknown,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    const handler = this.handlers[type];
    if (!handler.apply || !handler.applyDto) {
      throw new BadRequestException(
        'Este formulario es informativo: no tiene una acción que aprobar',
      );
    }
    const data = await validateFormPayload(handler.dataDto, storedData, 'form');
    const applyData = await validateFormPayload(
      handler.applyDto,
      applyPayload ?? {},
    );
    return handler.apply(data, applyData, context, tx);
  }
}
