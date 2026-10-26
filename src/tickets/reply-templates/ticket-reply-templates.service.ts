import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { assertBranchAccess } from 'src/common/utils/branch-access.util';
import {
  CreateTicketReplyTemplateDto,
  UpdateTicketReplyTemplateDto,
} from './dto/ticket-reply-template.dto';

const DUPLICATE_TITLE = {
  conflict: () => 'Ya existe una plantilla con ese título en la sucursal',
  notFound: 'Plantilla no encontrada',
};

/** Canned replies IT inserts into ticket comments, per branch. */
@Injectable()
export class TicketReplyTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(branchId: string, user: RequestUser) {
    assertBranchAccess(user, branchId);
    return this.prisma.ticketReplyTemplate.findMany({
      where: { branchId },
      orderBy: { title: 'asc' },
    });
  }

  async create(dto: CreateTicketReplyTemplateDto, user: RequestUser) {
    assertBranchAccess(user, dto.branchId);
    try {
      return await this.prisma.ticketReplyTemplate.create({
        data: { ...dto, title: dto.title.trim() },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TicketReplyTemplate', DUPLICATE_TITLE);
    }
  }

  async update(
    id: string,
    dto: UpdateTicketReplyTemplateDto,
    user: RequestUser,
  ) {
    await this.findAccessible(id, user);
    try {
      return await this.prisma.ticketReplyTemplate.update({
        where: { id },
        data: { ...dto, ...(dto.title && { title: dto.title.trim() }) },
      });
    } catch (error) {
      handleDatabaseErrors(error, 'TicketReplyTemplate', DUPLICATE_TITLE);
    }
  }

  async remove(id: string, user: RequestUser) {
    await this.findAccessible(id, user);
    await this.prisma.ticketReplyTemplate.delete({ where: { id } });
    return { deleted: 1 };
  }

  private async findAccessible(id: string, user: RequestUser) {
    const template = await this.prisma.ticketReplyTemplate.findUnique({
      where: { id },
      select: { branchId: true },
    });
    if (!template) throw new NotFoundException(DUPLICATE_TITLE.notFound);
    assertBranchAccess(user, template.branchId);
    return template;
  }
}
