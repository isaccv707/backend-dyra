import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { MailService } from 'src/mail/mail.service';
import { PRIVILEGED_PERMISSION_MODULES } from '../ticket-forms.const';
import { TicketFormStateService } from './ticket-form-state.service';
import { FORM_WORKFLOW_LOG_CONTEXT } from './ticket-form-workflow.const';

/** Access requests: the roles a requester may ask for and resending the email. */
@Injectable()
export class TicketFormAccessService {
  private readonly logger = new Logger(FORM_WORKFLOW_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly state: TicketFormStateService,
  ) {}

  /** Sends again the "your access is ready" email of an approved request. */
  async resendAccessEmail(id: string, user: RequestUser) {
    const ticket = await this.state.findTicketWithForm(id);
    assertBranchAccess(user, ticket.branchId);
    if (ticket.form?.type !== 'ACCESS_REQUEST' || !ticket.form.appliedAt) {
      throw new BadRequestException(
        'Solo se reenvía el correo de una solicitud de acceso aprobada',
      );
    }
    if (!user.role.permissions.includes('users:create')) {
      throw new ForbiddenException(
        'Reenviar el correo de acceso requiere el permiso users:create',
      );
    }

    const { fullName, email } = ticket.form.data as {
      fullName: string;
      email: string;
    };
    let emailSent = true;
    try {
      await this.mailService.sendAccessGrantedEmail(email, fullName);
    } catch (error) {
      emailSent = false;
      this.logger.error(
        `No se pudo reenviar el correo de acceso a ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.prisma.ticketForm.update({
      where: { ticketId: id },
      data: {
        result: {
          ...((ticket.form.result ?? {}) as Prisma.JsonObject),
          emailSent,
        },
      },
    });
    if (!emailSent) {
      throw new ServiceUnavailableException(
        `No se pudo enviar el correo a ${email}: inténtalo más tarde`,
      );
    }
    return this.state.findTicketSummary(id);
  }

  /**
   * Roles a requester may ask for in an access ticket: none that manages users,
   * roles or permissions (those are granted by an administrator directly).
   */
  findFormRoles() {
    return this.prisma.role.findMany({
      where: {
        permissions: {
          none: {
            OR: PRIVILEGED_PERMISSION_MODULES.map((module) => ({
              action: { startsWith: `${module}:` },
            })),
          },
        },
      },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }
}
