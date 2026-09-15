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
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticket: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    ticketComment: { create: jest.Mock };
    ticketNotification: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let gateway: {
    emitNewTicket: jest.Mock;
    emitTicketUpdated: jest.Mock;
    emitNewComment: jest.Mock;
    notifyUsers: jest.Mock;
  };

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
        update: jest.fn(),
      },
      ticketComment: { create: jest.fn() },
      ticketNotification: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    gateway = {
      emitNewTicket: jest.fn(),
      emitTicketUpdated: jest.fn(),
      emitNewComment: jest.fn(),
      notifyUsers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsGateway, useValue: gateway },
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

    it('aplica los filtros de status, category, priority y assignedToId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        {
          status: 'OPEN',
          category: 'HARDWARE',
          priority: 'HIGH',
          assignedToId: 'user-2',
        } as FindTicketsDto,
        globalUser,
      );

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'OPEN',
            category: 'HARDWARE',
            priority: 'HIGH',
            assignedToId: 'user-2',
          }),
        }),
      );
    });

    it('restringe la búsqueda a las sucursales del usuario TI cuando no manda branchId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedStaffUser);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: { in: [branchId] } }),
        }),
      );
    });

    it('restringe a los tickets propios cuando el usuario no tiene tickets:update', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedUser);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdById: scopedUser.id }),
        }),
      );
    });

    it('no restringe por createdById cuando el usuario tiene tickets:update', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, staffUser);

      const where = prisma.ticket.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('createdById');
    });

    it('no restringe por sucursal a un usuario sin tickets:update, aunque esté asignado a una sola sucursal', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedUser);

      const where = prisma.ticket.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('branchId');
    });

    it('permite filtrar por branchId a un usuario sin tickets:update como un filtro más sobre su propio histórico', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { branchId: 'other-branch' } as FindTicketsDto,
        scopedUser,
      );

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: 'other-branch',
            createdById: scopedUser.id,
          }),
        }),
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
        branchId: 'other-branch',
      });

      await expect(
        service.findOne('ticket-1', scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el dueño ve su ticket aunque ya no esté asignado a esa sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
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
        branchId: 'other-branch',
        createdById: 'someone-else',
        comments: [publicComment],
      });

      await expect(
        service.findOne('ticket-1', scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    const existingTicket = {
      id: 'ticket-1',
      branchId,
      status: 'OPEN',
      priority: 'MEDIUM',
      assignedToId: null,
      createdById: 'reporter-1',
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
        ['reporter-1', null],
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', null],
        'ticket-1',
        expect.stringContaining(staffUser.name),
      );
    });

    it('menciona al nuevo responsable cuando se reasigna el ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        branches: [],
        role: { permissions: [{ action: 'tickets:update' }] },
      });
      const updated = {
        ...existingTicket,
        assignedToId: 'tech-1',
        assignedTo: { id: 'tech-1', name: 'María', email: 'maria@dyra.com' },
      };
      prisma.ticket.update.mockResolvedValue(updated);
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { assignedToId: 'tech-1' } as UpdateTicketDto,
        staffUser,
      );

      const commentBody = prisma.ticketComment.create.mock.calls[0][0].data
        .body as string;
      expect(commentBody).toContain('María');
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
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

    it('permite desasignar el ticket enviando assignedToId: null', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...existingTicket,
        assignedToId: 'tech-1',
      });
      prisma.ticket.update.mockResolvedValue({ ...existingTicket });

      await service.update(
        'ticket-1',
        { assignedToId: null } as UpdateTicketDto,
        globalUser,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignedToId: null }),
        }),
      );
    });

    it('no toca assignedToId si se omite del dto', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.ticket.update.mockResolvedValue({ ...existingTicket });

      await service.update(
        'ticket-1',
        { status: 'IN_PROGRESS' } as UpdateTicketDto,
        globalUser,
      );

      const dataArg = prisma.ticket.update.mock.calls[0][0].data;
      expect(dataArg).not.toHaveProperty('assignedToId');
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

    it('lanza NotFoundException si el usuario a asignar no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update(
          'ticket-1',
          { assignedToId: 'ghost-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el usuario a asignar está inactivo', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        isActive: false,
        branches: [],
        role: { permissions: [{ action: 'tickets:update' }] },
      });

      await expect(
        service.update(
          'ticket-1',
          { assignedToId: 'tech-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el usuario a asignar no tiene tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        branches: [],
        role: { permissions: [] },
      });

      await expect(
        service.update(
          'ticket-1',
          { assignedToId: 'tech-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el usuario a asignar es de otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        branches: [{ id: 'other-branch' }],
        role: { permissions: [{ action: 'tickets:update' }] },
      });

      await expect(
        service.update(
          'ticket-1',
          { assignedToId: 'tech-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it('permite asignar a un técnico global (sin sucursales asignadas)', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        branches: [],
        role: { permissions: [{ action: 'tickets:update' }] },
      });
      prisma.ticket.update.mockResolvedValue({
        ...existingTicket,
        assignedToId: 'tech-1',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await expect(
        service.update(
          'ticket-1',
          { assignedToId: 'tech-1' } as UpdateTicketDto,
          staffUser,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('addComment', () => {
    const commentDto: CreateTicketCommentDto = { body: 'Ya voy en camino' };
    const ticketWithParties = {
      id: 'ticket-1',
      branchId,
      createdById: 'reporter-1',
      assignedToId: 'tech-1',
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
        branchId,
        createdById: 'someone-else',
      });

      await expect(
        service.addComment('ticket-1', commentDto, scopedUser),
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
      assignedToId: 'tech-1',
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
        assignedToId: null,
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
});
