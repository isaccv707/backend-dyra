import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { TicketReplyTemplatesService } from './ticket-reply-templates.service';

describe('TicketReplyTemplatesService', () => {
  const prisma = {
    ticketReplyTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new TicketReplyTemplatesService(
    prisma as unknown as PrismaService,
  );
  const staff: RequestUser = {
    id: 'staff-1',
    email: 'ti@dyra.com',
    name: 'TI',
    isActive: true,
    branches: [{ id: 'branch-1', name: 'Sucursal 1' }],
    role: { id: 'role-2', name: 'TI', permissions: ['tickets:update'] },
  };

  afterEach(() => jest.clearAllMocks());

  it('lista las plantillas de la sucursal por título', async () => {
    prisma.ticketReplyTemplate.findMany.mockResolvedValue([]);

    await service.findAll('branch-1', staff);

    expect(prisma.ticketReplyTemplate.findMany).toHaveBeenCalledWith({
      where: { branchId: 'branch-1' },
      orderBy: { title: 'asc' },
    });
  });

  it('no deja ver ni crear en una sucursal ajena', async () => {
    expect(() => service.findAll('branch-2', staff)).toThrow(
      ForbiddenException,
    );
    await expect(
      service.create(
        { branchId: 'branch-2', title: 'Reinicio', body: 'Reinicia' },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un título repetido en la sucursal es 409 con mensaje en español', async () => {
    prisma.ticketReplyTemplate.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.4.1',
      }),
    );

    await expect(
      service.create(
        { branchId: 'branch-1', title: ' Reinicio ', body: 'Reinicia' },
        staff,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Ya existe una plantilla con ese título en la sucursal',
    });
    expect(prisma.ticketReplyTemplate.create).toHaveBeenCalledWith({
      data: { branchId: 'branch-1', title: 'Reinicio', body: 'Reinicia' },
    });
  });

  it('editar o borrar una plantilla inexistente es 404', async () => {
    prisma.ticketReplyTemplate.findUnique.mockResolvedValue(null);

    await expect(
      service.update('tpl-1', { body: 'x' }, staff),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('tpl-1', staff)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
