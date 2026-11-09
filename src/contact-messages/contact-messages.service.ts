import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContactMessage, Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import { MailQueueService } from 'src/mail/mail-queue.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  ContactMessageReceivedDto,
  CreateContactMessageDto,
} from './dto/create-contact-message.dto';
import { FindContactMessagesDto } from './dto/find-contact-messages.dto';
import { UpdateContactMessageStatusDto } from './dto/update-contact-message-status.dto';
import {
  CONTACT_MESSAGES_UPDATE_PERMISSION,
  CONTACT_SUBJECT_LABELS,
  contactMessageDetailInclude,
  contactMessageListInclude,
} from './contact-messages.shared';

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'folio', 'status', 'name'];

@Injectable()
export class ContactMessagesService {
  private readonly logger = new Logger(ContactMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailQueue: MailQueueService,
  ) {}

  /** Public: stores the message (status NEW) and emails the branch's managers. */
  async create(
    dto: CreateContactMessageDto,
  ): Promise<ContactMessageReceivedDto> {
    if (dto.website) {
      this.logger.warn('Mensaje de contacto descartado por honeypot');
      return { received: true };
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true, name: true, isActive: true },
    });
    if (!branch || !branch.isActive) {
      throw new NotFoundException('Sucursal no encontrada');
    }

    const message = await this.prisma.contactMessage.create({
      data: {
        branchId: dto.branchId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
        privacyAcceptedAt: new Date(),
        history: { create: { toStatus: 'NEW' } },
      },
    });

    await this.notifyManagers(message, branch.name);
    return { received: true, folio: message.folio };
  }

  async findAll(dto: FindContactMessagesDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'email', 'phone'],
      defaultSort: { createdAt: 'desc' },
      allowedFields: SORTABLE_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.status && { status: dto.status }),
      ...(dto.subject && { subject: dto.subject }),
    } as Prisma.ContactMessageWhereInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: contactMessageListInclude,
      }),
      this.prisma.contactMessage.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  /** NEW messages in the user's branches (or one of them): admin menu badge. */
  async countPending(user: BranchScopedUser, branchId?: string) {
    const count = await this.prisma.contactMessage.count({
      where: { status: 'NEW', ...userBranchFilter(user, branchId) },
    });
    return { count };
  }

  async findOne(id: string, user: BranchScopedUser) {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: contactMessageDetailInclude,
    });
    if (!message) throw new NotFoundException('Mensaje no encontrado');
    assertBranchAccess(user, message.branchId);
    return message;
  }

  /** Changes the status and/or adds a note; every call leaves a history entry. */
  async updateStatus(
    id: string,
    dto: UpdateContactMessageStatusDto,
    user: RequestUser,
  ) {
    const current = await this.prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true, status: true, branchId: true },
    });
    if (!current) throw new NotFoundException('Mensaje no encontrado');
    assertBranchAccess(user, current.branchId);

    const note = dto.note || null;
    if (dto.status === current.status && !note) {
      throw new BadRequestException(
        'El mensaje ya tiene ese estatus; agrega una nota para registrar un seguimiento',
      );
    }

    return this.prisma.contactMessage.update({
      where: { id },
      data: {
        status: dto.status,
        history: {
          create: {
            fromStatus: current.status,
            toStatus: dto.status,
            note,
            changedById: user.id,
          },
        },
      },
      include: contactMessageDetailInclude,
    });
  }

  /** Active users with contact-messages:update for the branch (or global). */
  private findManagers(branchId: string) {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          permissions: {
            some: { action: CONTACT_MESSAGES_UPDATE_PERMISSION },
          },
        },
        OR: [
          { branches: { none: {} } },
          { branches: { some: { id: branchId } } },
        ],
      },
      select: { email: true },
    });
  }

  /** The message is already stored: a notification failure is only logged. */
  private async notifyManagers(message: ContactMessage, branchName: string) {
    try {
      const managers = await this.findManagers(message.branchId);
      if (managers.length === 0) {
        this.logger.warn(
          `Mensaje de contacto #${message.folio} sin destinatarios en ${branchName}`,
        );
        return;
      }
      for (const { email } of managers) {
        this.mailQueue.enqueue({
          type: 'newContactMessage',
          to: email,
          data: {
            contactMessageId: message.id,
            folio: message.folio,
            branchName,
            subjectLabel: CONTACT_SUBJECT_LABELS[message.subject],
            name: message.name,
            email: message.email,
            phone: message.phone,
            message: message.message,
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `No se pudo notificar el mensaje de contacto #${message.folio}: ${(error as Error).message}`,
      );
    }
  }
}
