import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import { MailService } from 'src/mail/mail.service';
import { UsersService } from 'src/users/users.service';
import {
  AccessRequestFormDto,
  ApplyAccessRequestFormDto,
} from '../dto/access-request-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { isPrivilegedPermission, ticketTitle } from '../ticket-forms.const';

@Injectable()
export class AccessRequestFormHandler implements TicketFormHandler<
  AccessRequestFormDto,
  ApplyAccessRequestFormDto
> {
  private readonly logger = new Logger(AccessRequestFormHandler.name);

  readonly type = 'ACCESS_REQUEST' as const;
  readonly dataDto = AccessRequestFormDto;
  readonly applyDto = ApplyAccessRequestFormDto;

  constructor(
    private readonly users: UsersService,
    private readonly mailService: MailService,
  ) {}

  async validate(
    data: AccessRequestFormDto,
    { phase, actor }: TicketFormContext,
    db: TicketFormDb,
  ) {
    const [role, branch] = await Promise.all([
      db.role.findUnique({
        where: { id: data.roleId },
        select: { name: true, permissions: { select: { action: true } } },
      }),
      db.branch.findUnique({
        where: { id: data.branchId },
        select: { id: true },
      }),
    ]);
    if (!role) {
      throw new BadRequestException(['form.roleId: el rol no existe']);
    }
    if (!branch) {
      throw new BadRequestException(['form.branchId: la sucursal no existe']);
    }

    const rolePermissions = role.permissions.map((p) => p.action);
    if (phase === 'request') {
      // Roles that manage users, roles or permissions are granted directly by
      // an administrator, never through a ticket.
      if (rolePermissions.some(isPrivilegedPermission)) {
        throw new BadRequestException([
          `form.roleId: el rol ${role.name} solo lo asigna un administrador`,
        ]);
      }
    } else {
      // Asked only of IT (users:create): checking it on request would let any
      // requester find out which emails have an account.
      const existingUser = await db.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      });
      if (existingUser) {
        throw new ConflictException(
          `Ya existe un usuario con el correo ${data.email}`,
        );
      }
      // No privilege escalation: the approver must already hold every
      // permission of the role being granted.
      const missing = rolePermissions.filter(
        (action) => !actor.role.permissions.includes(action),
      );
      if (missing.length) {
        throw new ForbiddenException(
          `No puedes asignar el rol ${role.name}: tiene permisos que tú no tienes (${missing.join(', ')})`,
        );
      }
    }

    return { title: ticketTitle('Acceso', data.fullName) };
  }

  async apply(
    data: AccessRequestFormDto,
    applyData: ApplyAccessRequestFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    assertBranchAccess(context.actor, data.branchId);
    const roleId = applyData.roleId ?? data.roleId;
    await this.validate({ ...data, roleId }, context, tx);

    // Nobody knows this password: the user sets one through "forgot password".
    const user = await this.users.create(
      {
        email: data.email,
        name: data.fullName,
        password: randomBytes(24).toString('base64url'),
        roleId,
        branchIds: [data.branchId],
        isActive: true,
      },
      tx,
    );

    return {
      // emailSent: null until the email goes out (see afterCommit).
      result: {
        userId: user?.id ?? null,
        email: data.email,
        roleId,
        emailSent: null,
      },
      summary: `creó el usuario ${data.email}`,
      afterCommit: async () => {
        try {
          await this.mailService.sendAccessGrantedEmail(
            data.email,
            data.fullName,
          );
          return { emailSent: true };
        } catch (error) {
          this.logger.error(
            `No se pudo enviar el correo de acceso a ${data.email}`,
            error instanceof Error ? error.stack : String(error),
          );
          return { emailSent: false };
        }
      },
    };
  }
}
