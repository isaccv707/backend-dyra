import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { TicketsService } from './tickets.service';
import { TicketsGateway } from './tickets.gateway';
import { MailService } from 'src/mail/mail.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { SetTicketAssigneesDto } from './dto/set-ticket-assignees.dto';

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticket: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    ticketAssignee: { deleteMany: jest.Mock; createMany: jest.Mock };
    ticketComment: { create: jest.Mock };
    ticketNotification: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    ticketEvent: { create: jest.Mock; createMany: jest.Mock };
    ticketSubcategory: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let gateway: {
    emitNewTicket: jest.Mock;
    emitTicketUpdated: jest.Mock;
    emitNewComment: jest.Mock;
    notifyUsers: jest.Mock;
    emitOverdueTicket: jest.Mock;
  };
  let mailService: { sendTicketAssignedEmail: jest.Mock };

  const branchId = 'branch-1';

  const globalUser: RequestUser = {
    id: 'user-1',
    email: 'reportero@dyra.com',
    name: 'Reportero',
    isActive: true,
    branches: [],
    role: { id: 'role-1', name: 'Reportero', permissions: [] },
  };
  const scopedUser: RequestUser = {
    ...globalUser,
    branches: [{ id: branchId, name: 'Sucursal 1' }],
  };
  const staffUser: RequestUser = {
    id: 'staff-1',
    email: 'ti@dyra.com',
    name: 'TI',
    isActive: true,
    branches: [],
    role: { id: 'role-2', name: 'TI', permissions: ['tickets:update'] },
  };
  const scopedStaffUser: RequestUser = {
    ...staffUser,
    branches: [{ id: branchId, name: 'Sucursal 1' }],
  };

  const createDto: CreateTicketDto = {
    branchId,
    title: 'No enciende el monitor',
    description: 'El monitor de la sala 2 no enciende',
    category: 'HARDWARE',
  } as CreateTicketDto;

  beforeEach(async () => {
    prisma = {
      ticket: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      ticketAssignee: { deleteMany: jest.fn(), createMany: jest.fn() },
      ticketComment: { create: jest.fn() },
      ticketNotification: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      ticketEvent: { create: jest.fn(), createMany: jest.fn() },
      ticketSubcategory: { findUnique: jest.fn() },
      user: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    gateway = {
      emitNewTicket: jest.fn(),
      emitTicketUpdated: jest.fn(),
      emitNewComment: jest.fn(),
      notifyUsers: jest.fn(),
      emitOverdueTicket: jest.fn(),
    };
    mailService = {
      sendTicketAssignedEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsGateway, useValue: gateway },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('crea el ticket, fija createdById y notifica por el gateway', async () => {
      const created = { id: 'ticket-1', ...createDto, createdById: 'user-1' };
      prisma.ticket.create.mockResolvedValue(created);

      const result = await service.create(createDto, globalUser);

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ branchId, createdById: 'user-1' }),
        }),
      );
      expect(gateway.emitNewTicket).toHaveBeenCalledWith(created);
      expect(result).toBe(created);
    });

    it('lanza ForbiddenException si el usuario no tiene acceso a la sucursal', async () => {
      const otherBranchUser: RequestUser = {
        ...globalUser,
        branches: [{ id: 'branch-2', name: 'Sucursal 2' }],
      };

      await expect(
        service.create(createDto, otherBranchUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('traduce un P2002 de Prisma en un 409 (ConflictException)', async () => {
      prisma.ticket.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.4.1',
        }),
      );

      await expect(service.create(createDto, globalUser)).rejects.toMatchObject(
        { status: 409 },
      );
    });
  });

  describe('findAll', () => {
    it('devuelve la respuesta paginada armada desde $transaction', async () => {
      const tickets = [{ id: 'ticket-1' }];
      prisma.$transaction.mockResolvedValue([tickets, 1]);

      const result = await service.findAll(
        { page: 1, limit: 10 } as FindTicketsDto,
        scopedUser,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        data: tickets,
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    const whereConditions = () =>
      prisma.ticket.findMany.mock.calls[0][0].where.AND as unknown[];

    it('aplica los filtros de status, category, priority y assigneeId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        {
          status: 'OPEN',
          category: 'HARDWARE',
          priority: 'HIGH',
          assigneeId: 'user-2',
        } as FindTicketsDto,
        globalUser,
      );

      expect(whereConditions()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'OPEN',
            category: 'HARDWARE',
            priority: 'HIGH',
          }),
          { assignees: { some: { userId: 'user-2' } } },
        ]),
      );
    });

    it('assignedToMe=true filtra los tickets asignados al usuario autenticado', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { assignedToMe: true } as FindTicketsDto,
        staffUser,
      );

      expect(whereConditions()).toContainEqual({
        assignees: { some: { userId: staffUser.id } },
      });
    });

    it('restringe la búsqueda a las sucursales del usuario TI cuando no manda branchId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedStaffUser);

      expect(whereConditions()).toContainEqual(
        expect.objectContaining({ branchId: { in: [branchId] } }),
      );
    });

    it('sin tickets:update, restringe a los tickets propios o asignados', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedUser);

      expect(whereConditions()).toContainEqual({
        OR: [
          { createdById: scopedUser.id },
          { assignees: { some: { userId: scopedUser.id } } },
        ],
      });
    });

    it('no restringe por creador/asignado cuando el usuario tiene tickets:update', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, staffUser);

      const where = JSON.stringify(
        prisma.ticket.findMany.mock.calls[0][0].where,
      );
      expect(where).not.toContain('createdById');
      expect(where).not.toContain('assignees');
    });

    it('no restringe por sucursal a un usuario sin tickets:update, aunque esté asignado a una sola sucursal', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedUser);

      const where = JSON.stringify(
        prisma.ticket.findMany.mock.calls[0][0].where,
      );
      expect(where).not.toContain('branchId');
    });

    it('permite filtrar por branchId a un usuario sin tickets:update como un filtro más sobre sus tickets', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { branchId: 'other-branch' } as FindTicketsDto,
        scopedUser,
      );

      expect(whereConditions()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ branchId: 'other-branch' }),
          {
            OR: [
              { createdById: scopedUser.id },
              { assignees: { some: { userId: scopedUser.id } } },
            ],
          },
        ]),
      );
    });
  });

  describe('findOne', () => {
    const internalComment = {
      id: 'comment-1',
      body: 'Nota interna: revisar con proveedor',
      isInternal: true,
    };
    const publicComment = {
      id: 'comment-2',
      body: 'Ya casi lo resolvemos',
      isInternal: false,
    };

    it('devuelve el ticket con sus comentarios cuando existe y el usuario tiene acceso', async () => {
      const ticket = {
        id: 'ticket-1',
        assignees: [],
        branchId,
        createdById: scopedUser.id,
        comments: [publicComment],
      };
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result).toEqual({ ...ticket, comments: [publicComment] });
    });

    it('oculta las notas internas a un usuario sin el permiso tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId,
        createdById: scopedUser.id,
        comments: [internalComment, publicComment],
      });

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result.comments).toEqual([publicComment]);
    });

    it('lanza ForbiddenException si el ticket es de otro usuario y no tiene tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId,
        createdById: 'someone-else',
        comments: [publicComment],
      });

      await expect(
        service.findOne('ticket-1', scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('incluye las notas internas para un usuario con el permiso tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId,
        comments: [internalComment, publicComment],
      });

      const result = await service.findOne('ticket-1', staffUser);

      expect(result.comments).toEqual([internalComment, publicComment]);
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('missing', globalUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si el ticket es de otro usuario, aunque sea de la misma sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId: 'other-branch',
      });

      await expect(
        service.findOne('ticket-1', scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el dueño ve su ticket aunque ya no esté asignado a esa sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId: 'other-branch',
        createdById: scopedUser.id,
        comments: [publicComment],
      });

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result.comments).toEqual([publicComment]);
    });

    it('lanza ForbiddenException si el usuario TI no tiene acceso a la sucursal del ticket ajeno', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId: 'other-branch',
        createdById: 'someone-else',
        comments: [publicComment],
      });

      await expect(
        service.findOne('ticket-1', scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un usuario asignado sin tickets:update ve el ticket, pero no las notas internas', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        createdById: 'someone-else',
        assignees: [{ user: { id: scopedUser.id } }],
        comments: [internalComment, publicComment],
      });

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result.comments).toEqual([publicComment]);
    });
  });

  describe('update', () => {
    const existingTicket = {
      id: 'ticket-1',
      branchId,
      status: 'OPEN',
      priority: 'MEDIUM',
      createdById: 'reporter-1',
      assignees: [],
    };

    it('actualiza el ticket y notifica por el gateway', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      const updated = { ...existingTicket, status: 'RESOLVED' };
      prisma.ticket.update.mockResolvedValue(updated);
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      const result = await service.update(
        'ticket-1',
        { status: 'RESOLVED' } as UpdateTicketDto,
        staffUser,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({ status: 'RESOLVED' }),
        }),
      );
      expect(gateway.emitTicketUpdated).toHaveBeenCalledWith(updated);
      expect(result).toBe(updated);
    });

    it('deja un comentario de sistema y avisa al creador cuando cambia el estado', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      const updated = { ...existingTicket, status: 'RESOLVED' };
      prisma.ticket.update.mockResolvedValue(updated);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isSystem: true,
      });

      await service.update(
        'ticket-1',
        { status: 'RESOLVED' } as UpdateTicketDto,
        staffUser,
      );

      expect(prisma.ticketComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isSystem: true,
            isInternal: false,
            ticketId: 'ticket-1',
            authorId: staffUser.id,
          }),
        }),
      );
      const auditBody = prisma.ticketComment.create.mock.calls[0][0].data
        .body as string;
      expect(auditBody).toContain('Abierto');
      expect(auditBody).toContain('Resuelto');
      expect(gateway.emitNewComment).toHaveBeenCalledWith(
        'ticket-1',
        expect.objectContaining({ id: 'comment-1' }),
        ['reporter-1'],
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1'],
        'ticket-1',
        expect.stringContaining(staffUser.name),
      );
    });

    it('avisa también a todos los asignados del ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.ticket.update.mockResolvedValue({
        ...existingTicket,
        status: 'IN_PROGRESS',
        assignees: [{ user: { id: 'tech-1' } }, { user: { id: 'tech-2' } }],
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { status: 'IN_PROGRESS' } as UpdateTicketDto,
        staffUser,
      );

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1', 'tech-2'],
        'ticket-1',
        expect.any(String),
      );
    });

    it('no genera comentario de sistema ni notifica si nada auditable cambió', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.ticket.update.mockResolvedValue({ ...existingTicket });

      await service.update('ticket-1', {} as UpdateTicketDto, staffUser);

      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
      expect(gateway.notifyUsers).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.update(
          'missing',
          { status: 'RESOLVED' } as UpdateTicketDto,
          globalUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('lanza ForbiddenException si el ticket pertenece a otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId: 'other-branch',
      });

      await expect(
        service.update(
          'ticket-1',
          { status: 'RESOLVED' } as UpdateTicketDto,
          scopedUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la transición de estado no es válida', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...existingTicket,
        status: 'CLOSED',
      });

      await expect(
        service.update(
          'ticket-1',
          { status: 'RESOLVED' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('permite reabrir un ticket CLOSED a IN_PROGRESS', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...existingTicket,
        status: 'CLOSED',
      });
      prisma.ticket.update.mockResolvedValue({
        ...existingTicket,
        status: 'IN_PROGRESS',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await expect(
        service.update(
          'ticket-1',
          { status: 'IN_PROGRESS' } as UpdateTicketDto,
          staffUser,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('setAssignees', () => {
    const ticket = {
      id: 'ticket-1',
      code: 42,
      title: 'No enciende el monitor',
      priority: 'HIGH',
      branchId,
      createdById: 'reporter-1',
      firstResponseAt: null,
      branch: { name: 'Sucursal 1' },
      assignees: [{ userId: 'old-1', user: { name: 'Pedro' } }],
    };
    const activeUser = (id: string, name: string) => ({
      id,
      name,
      email: `${id}@dyra.com`,
      isActive: true,
      branches: [{ id: branchId }],
    });
    const setDto = (userIds: string[]) =>
      ({ userIds }) as SetTicketAssigneesDto;

    beforeEach(() => {
      prisma.$transaction.mockResolvedValue([]);
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });
    });

    it('agrega los nuevos, quita los que salen, registra eventos y manda correo solo a los nuevos', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([activeUser('new-1', 'María')]);
      const updated = {
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      };
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.setAssignees(
        'ticket-1',
        setDto(['new-1']),
        staffUser,
      );

      expect(prisma.ticketAssignee.deleteMany).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1', userId: { in: ['old-1'] } },
      });
      expect(prisma.ticketAssignee.createMany).toHaveBeenCalledWith({
        data: [
          { ticketId: 'ticket-1', userId: 'new-1', assignedById: staffUser.id },
        ],
      });
      expect(prisma.ticketEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ type: 'ASSIGNED', toValue: 'new-1' }),
          expect.objectContaining({ type: 'UNASSIGNED', fromValue: 'old-1' }),
        ],
      });
      const body = prisma.ticketComment.create.mock.calls[0][0].data
        .body as string;
      expect(body).toContain('María');
      expect(body).toContain('Pedro');
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'new-1'],
        'ticket-1',
        expect.any(String),
      );
      expect(mailService.sendTicketAssignedEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendTicketAssignedEmail).toHaveBeenCalledWith(
        'new-1@dyra.com',
        {
          ticketId: 'ticket-1',
          code: 42,
          title: 'No enciende el monitor',
          priorityLabel: 'Alta',
          branchName: 'Sucursal 1',
          assignedByName: staffUser.name,
        },
      );
      expect(gateway.emitTicketUpdated).toHaveBeenCalledWith(updated);
      expect(result).toBe(updated);
    });

    it('fija firstResponseAt en la primera asignación', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ ...ticket, assignees: [] });
      prisma.user.findMany.mockResolvedValue([activeUser('new-1', 'María')]);
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      });

      await service.setAssignees('ticket-1', setDto(['new-1']), staffUser);

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { firstResponseAt: expect.any(Date) },
      });
    });

    it('no registra cambios ni manda correos si la lista no cambió', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({
        id: 'ticket-1',
        assignees: [{ user: { id: 'old-1' } }],
      });

      await service.setAssignees('ticket-1', setDto(['old-1']), staffUser);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
      expect(mailService.sendTicketAssignedEmail).not.toHaveBeenCalled();
    });

    it('la asignación se mantiene aunque el correo falle', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ ...ticket, assignees: [] });
      prisma.user.findMany.mockResolvedValue([activeUser('new-1', 'María')]);
      const updated = {
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      };
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(updated);
      mailService.sendTicketAssignedEmail.mockRejectedValue(
        new Error('SMTP caído'),
      );

      await expect(
        service.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).resolves.toBe(updated);
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.setAssignees('missing', setDto([]), staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si TI no tiene acceso a la sucursal del ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticket,
        branchId: 'other-branch',
      });

      await expect(
        service.setAssignees('ticket-1', setDto([]), scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si un usuario a asignar no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.setAssignees('ticket-1', setDto(['ghost-1']), staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si se intenta asignar a quien reportó el ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        activeUser('reporter-1', 'Reportero'),
      ]);

      await expect(
        service.setAssignees('ticket-1', setDto(['reporter-1']), staffUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si un usuario a asignar está inactivo', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        { ...activeUser('new-1', 'María'), isActive: false },
      ]);

      await expect(
        service.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si un usuario a asignar no tiene acceso a la sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        { ...activeUser('new-1', 'María'), branches: [{ id: 'other-branch' }] },
      ]);

      await expect(
        service.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite asignar a cualquier usuario activo sin tickets:update, o global (sin sucursales)', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ ...ticket, assignees: [] });
      prisma.user.findMany.mockResolvedValue([
        { ...activeUser('new-1', 'María'), branches: [] },
      ]);
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      });

      await expect(
        service.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).resolves.toBeDefined();
    });
  });

  describe('findAssignableUsers', () => {
    const ticket = {
      branchId,
      createdById: 'reporter-1',
      assignees: [{ userId: 'tech-1' }],
    };

    it('filtra activos, de la sucursal del ticket (o globales) y distintos del creador, y marca isAssigned', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'tech-1',
          name: 'Ana',
          email: 'ana@dyra.com',
          role: { name: 'Soporte TI' },
        },
        {
          id: 'user-9',
          name: 'Luis',
          email: 'luis@dyra.com',
          role: { name: 'Usuario' },
        },
      ]);

      const result = await service.findAssignableUsers(
        'ticket-1',
        {},
        staffUser,
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            id: { not: 'reporter-1' },
            OR: [
              { branches: { none: {} } },
              { branches: { some: { id: branchId } } },
            ],
          },
          orderBy: { name: 'asc' },
        }),
      );
      expect(result.map((u) => [u.id, u.isAssigned])).toEqual([
        ['tech-1', true],
        ['user-9', false],
      ]);
    });

    it('aplica search sobre nombre o email', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAssignableUsers(
        'ticket-1',
        { search: '  mar ' },
        staffUser,
      );

      expect(prisma.user.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { name: { contains: 'mar', mode: 'insensitive' } },
            { email: { contains: 'mar', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.findAssignableUsers('missing', {}, staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si TI no tiene acceso a la sucursal del ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticket,
        branchId: 'other-branch',
      });

      await expect(
        service.findAssignableUsers('ticket-1', {}, scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    const commentDto: CreateTicketCommentDto = { body: 'Ya voy en camino' };
    const ticketWithParties = {
      id: 'ticket-1',
      branchId,
      createdById: 'reporter-1',
      assignees: [{ userId: 'tech-1' }],
    };

    it('crea el comentario y notifica por el gateway', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      const created = { id: 'comment-1', ...commentDto, isInternal: false };
      prisma.ticketComment.create.mockResolvedValue(created);

      const result = await service.addComment(
        'ticket-1',
        commentDto,
        staffUser,
      );

      expect(prisma.ticketComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body: commentDto.body,
            isInternal: false,
            ticketId: 'ticket-1',
            authorId: staffUser.id,
          }),
        }),
      );
      expect(gateway.emitNewComment).toHaveBeenCalledWith('ticket-1', created, [
        'reporter-1',
        'tech-1',
      ]);
      expect(result).toBe(created);
    });

    it('avisa al creador y al asignado (pero no al autor del comentario)', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', commentDto, staffUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        'ticket-1',
        expect.stringContaining(staffUser.name),
      );
    });

    it('no notifica cuando el propio creador comenta su ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticketWithParties,
        createdById: scopedUser.id,
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', commentDto, scopedUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['tech-1'],
        'ticket-1',
        expect.any(String),
      );
    });

    it('no notifica por notas internas (ya llegan solo a TI vía emitNewComment)', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: true,
      });

      await service.addComment(
        'ticket-1',
        { ...commentDto, isInternal: true },
        staffUser,
      );

      expect(gateway.notifyUsers).not.toHaveBeenCalled();
    });

    it('permite isInternal:true cuando el usuario tiene el permiso tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.addComment(
        'ticket-1',
        { ...commentDto, isInternal: true },
        staffUser,
      );

      expect(prisma.ticketComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isInternal: true }),
        }),
      );
    });

    it('lanza ForbiddenException si un usuario sin permiso intenta isInternal:true', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId,
        createdById: scopedUser.id,
      });

      await expect(
        service.addComment(
          'ticket-1',
          { ...commentDto, isInternal: true },
          scopedUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.addComment('missing', commentDto, globalUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si el ticket pertenece a otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId: 'other-branch',
      });

      await expect(
        service.addComment('ticket-1', commentDto, scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
    });

    it('lanza ForbiddenException si el ticket es de otro usuario y no tiene tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId,
        createdById: 'someone-else',
      });

      await expect(
        service.addComment('ticket-1', commentDto, scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
    });

    it('un usuario asignado sin tickets:update puede comentar y avisa al creador', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        createdById: 'reporter-1',
        assignees: [{ userId: scopedUser.id }, { userId: 'tech-2' }],
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', commentDto, scopedUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-2'],
        'ticket-1',
        expect.any(String),
      );
    });

    it('un usuario asignado sin tickets:update no puede crear notas internas', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        createdById: 'reporter-1',
        assignees: [{ userId: scopedUser.id }],
      });

      await expect(
        service.addComment(
          'ticket-1',
          { ...commentDto, isInternal: true },
          scopedUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
    });
  });

  describe('persistencia de notificaciones', () => {
    const commentDto: CreateTicketCommentDto = { body: 'Ya voy en camino' };
    const ticketWithParties = {
      id: 'ticket-1',
      branchId,
      createdById: 'reporter-1',
      assignees: [{ userId: 'tech-1' }],
    };

    it('guarda una TicketNotification por cada destinatario antes de emitir por el gateway', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', commentDto, staffUser);

      expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'reporter-1',
            ticketId: 'ticket-1',
            message: expect.stringContaining(staffUser.name),
          },
          {
            userId: 'tech-1',
            ticketId: 'ticket-1',
            message: expect.stringContaining(staffUser.name),
          },
        ],
      });
    });

    it('no llama a createMany si no hay destinatarios', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticketWithParties,
        createdById: staffUser.id,
        assignees: [],
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', commentDto, staffUser);

      expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('findMyNotifications', () => {
    it('filtra por el usuario autenticado y por read cuando se manda', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findMyNotifications(
        { page: 1, limit: 10, read: false } as any,
        staffUser,
      );

      expect(prisma.ticketNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: staffUser.id,
            read: false,
          }),
        }),
      );
    });
  });

  describe('markNotificationRead', () => {
    it('marca como leída una notificación propia', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: staffUser.id,
      });
      prisma.ticketNotification.update.mockResolvedValue({
        id: 'notif-1',
        read: true,
      });

      const result = await service.markNotificationRead('notif-1', staffUser);

      expect(prisma.ticketNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { read: true },
      });
      expect(result).toEqual({ id: 'notif-1', read: true });
    });

    it('lanza NotFoundException si la notificación no existe', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue(null);

      await expect(
        service.markNotificationRead('missing', staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si la notificación es de otro usuario', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'someone-else',
      });

      await expect(
        service.markNotificationRead('notif-1', staffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketNotification.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('marca como leídas todas las notificaciones pendientes del usuario', async () => {
      prisma.ticketNotification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllNotificationsRead(staffUser);

      expect(prisma.ticketNotification.updateMany).toHaveBeenCalledWith({
        where: { userId: staffUser.id, read: false },
        data: { read: true },
      });
      expect(result).toEqual({ updated: 3 });
    });
  });

  describe('trazabilidad: subcategoría', () => {
    it('valida la subcategoría contra la categoría del ticket al crear', async () => {
      prisma.ticketSubcategory.findUnique.mockResolvedValue({
        category: 'SOFTWARE',
      });

      await expect(
        service.create(
          { ...createDto, category: 'HARDWARE', subcategoryId: 'sub-1' } as any,
          globalUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si la subcategoría no existe', async () => {
      prisma.ticketSubcategory.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { ...createDto, subcategoryId: 'ghost' } as any,
          globalUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crea el ticket cuando la subcategoría pertenece a la categoría', async () => {
      prisma.ticketSubcategory.findUnique.mockResolvedValue({
        category: 'HARDWARE',
      });
      prisma.ticket.create.mockResolvedValue({ id: 'ticket-1' });

      await expect(
        service.create(
          { ...createDto, category: 'HARDWARE', subcategoryId: 'sub-1' } as any,
          globalUser,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('trazabilidad: SLA y ciclo de vida', () => {
    const baseTicket = {
      id: 'ticket-1',
      branchId,
      status: 'OPEN' as const,
      priority: 'MEDIUM' as const,
      category: 'HARDWARE' as const,
      subcategoryId: null,
      assignees: [],
      createdById: 'reporter-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      resolvedAt: null,
      closedAt: null,
      reopenedCount: 0,
      firstResponseAt: null,
    };

    it('fija resolvedAt al pasar a RESOLVED', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      prisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        status: 'RESOLVED',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { status: 'RESOLVED' } as UpdateTicketDto,
        staffUser,
      );

      const data = prisma.ticket.update.mock.calls[0][0].data;
      expect(data.resolvedAt).toBeInstanceOf(Date);
    });

    it('limpia resolvedAt/closedAt e incrementa reopenedCount al reabrir un ticket RESOLVED', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        status: 'RESOLVED',
        resolvedAt: new Date(),
      });
      prisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        status: 'IN_PROGRESS',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { status: 'IN_PROGRESS' } as UpdateTicketDto,
        staffUser,
      );

      const data = prisma.ticket.update.mock.calls[0][0].data;
      expect(data.resolvedAt).toBeNull();
      expect(data.closedAt).toBeNull();
      expect(data.reopenedCount).toBe(1);
    });

    it('recalcula dueAt a partir de createdAt cuando cambia la prioridad', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      prisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        priority: 'CRITICAL',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { priority: 'CRITICAL' } as UpdateTicketDto,
        staffUser,
      );

      const data = prisma.ticket.update.mock.calls[0][0].data;
      expect(data.dueAt).toEqual(
        new Date(baseTicket.createdAt.getTime() + 4 * 60 * 60 * 1000),
      );
      expect(data.overdueNotifiedAt).toBeNull();
    });

    it('valida la subcategoría contra la categoría vigente al actualizar', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      prisma.ticketSubcategory.findUnique.mockResolvedValue({
        category: 'SOFTWARE',
      });

      await expect(
        service.update(
          'ticket-1',
          { subcategoryId: 'sub-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('trazabilidad: primera respuesta en addComment', () => {
    const ticketWithParties = {
      id: 'ticket-1',
      branchId,
      createdById: 'reporter-1',
      assignees: [{ userId: 'tech-1' }],
      firstResponseAt: null,
    };

    it('fija firstResponseAt cuando alguien distinto al creador comenta por primera vez', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment(
        'ticket-1',
        { body: 'Ya voy en camino' },
        staffUser,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { firstResponseAt: expect.any(Date) },
      });
    });

    it('no toca firstResponseAt cuando el propio creador comenta', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticketWithParties,
        createdById: scopedUser.id,
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment('ticket-1', { body: 'Aviso' }, scopedUser);

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('no vuelve a tocar firstResponseAt si ya estaba fijo', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticketWithParties,
        firstResponseAt: new Date('2026-01-01'),
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await service.addComment(
        'ticket-1',
        { body: 'Otro comentario' },
        staffUser,
      );

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('notifyOverdueTickets', () => {
    it('avisa al creador, transmite a TI y marca overdueNotifiedAt por cada ticket vencido', async () => {
      const overdueTicket = {
        id: 'ticket-1',
        code: 42,
        title: 'No enciende el monitor',
        createdById: 'reporter-1',
      };
      prisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      prisma.ticket.update.mockResolvedValue(overdueTicket);

      const result = await service.notifyOverdueTickets();

      expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'reporter-1',
            ticketId: 'ticket-1',
            message: expect.stringContaining('#42'),
          },
        ],
      });
      expect(gateway.emitOverdueTicket).toHaveBeenCalledWith({
        id: 'ticket-1',
        code: 42,
        title: 'No enciende el monitor',
      });
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { overdueNotifiedAt: expect.any(Date) },
      });
      expect(result).toEqual({ notified: 1 });
    });

    it('no hace nada si no hay tickets vencidos', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      const result = await service.notifyOverdueTickets();

      expect(prisma.ticket.update).not.toHaveBeenCalled();
      expect(result).toEqual({ notified: 0 });
    });
  });
});
