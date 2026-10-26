import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { computeDueAt } from './constants/ticket-sla.const';
import {
  addBusinessTime,
  businessTimeBetween,
} from './constants/business-hours';
import { TicketsService } from './tickets.service';
import {
  createTicketsTestContext,
  branchId,
  globalUser,
  scopedUser,
  staffUser,
  scopedStaffUser,
  createDto,
  TicketsTestContext,
} from './testing/tickets-test-context';

describe('TicketsService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let mailQueue: TicketsTestContext['mailQueue'];
  let service: TicketsService;

  beforeEach(async () => {
    ({
      prisma,
      gateway,
      mailQueue,
      ticketsService: service,
    } = await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('asigna el folio siguiente de la sucursal', async () => {
      prisma.ticket.create.mockResolvedValue({ id: 'ticket-1' });

      await service.create(createDto, globalUser);

      expect(prisma.ticketCounter.upsert).toHaveBeenCalledWith({
        where: { branchId },
        create: { branchId, lastCode: 1 },
        update: { lastCode: { increment: 1 } },
      });
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 7 }) }),
      );
    });

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

    describe('aviso a TI', () => {
      const created = {
        id: 'ticket-1',
        code: 7,
        title: 'No enciende el monitor',
        branchId,
        category: 'HARDWARE',
        priority: 'MEDIUM',
        branch: { id: branchId, name: 'Sucursal 1' },
        createdById: globalUser.id,
        assignees: [],
      };

      beforeEach(() => {
        prisma.ticket.create.mockResolvedValue(created);
        prisma.user.findMany.mockResolvedValue([
          { id: 'staff-1', email: 'ti@dyra.com' },
          { id: 'staff-2', email: 'ti2@dyra.com' },
        ]);
      });

      it('busca a TI activo de la sucursal (o global)', async () => {
        await service.create(createDto, globalUser);

        expect(prisma.user.findMany).toHaveBeenCalledWith({
          where: {
            isActive: true,
            role: {
              permissions: { some: { action: 'tickets:update' } },
            },
            OR: [
              { branches: { none: {} } },
              { branches: { some: { id: branchId } } },
            ],
          },
          select: { id: true, email: true },
        });
      });

      it('guarda la notificación NEW_TICKET y la emite por el gateway', async () => {
        await service.create(createDto, globalUser);

        expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
          data: ['staff-1', 'staff-2'].map((userId) => ({
            userId,
            ticketId: 'ticket-1',
            kind: 'NEW_TICKET',
            message: expect.stringContaining('#7'),
            actorId: globalUser.id,
          })),
        });
        expect(gateway.notifyUsers).toHaveBeenCalledWith(
          ['staff-1', 'staff-2'],
          expect.objectContaining({ ticketId: 'ticket-1', kind: 'NEW_TICKET' }),
        );
      });

      it('encola un correo a cada miembro de TI', async () => {
        await service.create(createDto, globalUser);

        expect(mailQueue.enqueue).toHaveBeenCalledTimes(2);
        expect(mailQueue.enqueue).toHaveBeenCalledWith({
          type: 'newTicket',
          to: 'ti@dyra.com',
          data: {
            ticketId: 'ticket-1',
            code: 7,
            title: 'No enciende el monitor',
            categoryLabel: 'Hardware',
            priorityLabel: 'Media',
            branchName: 'Sucursal 1',
            createdByName: globalUser.name,
          },
        });
      });

      it('si quien crea es TI, no se avisa a sí mismo', async () => {
        prisma.ticket.create.mockResolvedValue({
          ...created,
          createdById: 'staff-1',
        });

        await service.create(createDto, { ...staffUser, id: 'staff-1' });

        expect(gateway.notifyUsers).toHaveBeenCalledWith(
          ['staff-2'],
          expect.objectContaining({ kind: 'NEW_TICKET' }),
        );
        expect(mailQueue.enqueue).toHaveBeenCalledTimes(1);
        expect(mailQueue.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ to: 'ti2@dyra.com' }),
        );
      });

      it('sin TI que avisar no guarda notificaciones ni envía correos', async () => {
        prisma.user.findMany.mockResolvedValue([]);

        await service.create(createDto, globalUser);

        expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
        expect(mailQueue.enqueue).not.toHaveBeenCalled();
      });

      it('un fallo al avisar no hace fallar la creación', async () => {
        prisma.ticketNotification.createMany.mockRejectedValue(
          new Error('db caída'),
        );

        await expect(service.create(createDto, globalUser)).resolves.toBe(
          created,
        );
      });
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

    it('limita a 10 los tickets creados por minuto (los rechazados no cuentan)', async () => {
      prisma.ticket.count.mockResolvedValue(10);

      await expect(service.create(createDto, globalUser)).rejects.toMatchObject(
        { status: 429 },
      );
      expect(prisma.ticket.count).toHaveBeenCalledWith({
        where: {
          createdById: globalUser.id,
          createdAt: { gte: expect.any(Date) },
        },
      });
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

    it('con branchId, acota sus tickets a esa sucursal pero conserva los asignados de sucursales sin acceso', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ branchId } as FindTicketsDto, scopedUser);

      expect(whereConditions()).toContainEqual({
        OR: [
          { createdById: scopedUser.id, branchId },
          { assignees: { some: { userId: scopedUser.id } }, branchId },
          {
            assignees: { some: { userId: scopedUser.id } },
            branchId: { notIn: [branchId] },
          },
        ],
      });
    });

    it('con branchId, un usuario global no agrega asignados de otras sucursales', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ branchId } as FindTicketsDto, globalUser);

      expect(whereConditions()).toContainEqual({
        OR: [
          { createdById: globalUser.id, branchId },
          { assignees: { some: { userId: globalUser.id } }, branchId },
        ],
      });
    });

    it('mine=true restringe a TI a sus tickets propios o asignados, sin el filtro de sucursales de la bandeja', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { mine: true, branchId } as FindTicketsDto,
        scopedStaffUser,
      );

      expect(whereConditions()).toContainEqual({
        OR: [
          { createdById: scopedStaffUser.id, branchId },
          { assignees: { some: { userId: scopedStaffUser.id } }, branchId },
          {
            assignees: { some: { userId: scopedStaffUser.id } },
            branchId: { notIn: [branchId] },
          },
        ],
      });
      expect(whereConditions()).not.toContainEqual(
        expect.objectContaining({ branchId: { in: [branchId] } }),
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
        expect.objectContaining({ id: 'ticket-1' }),
        expect.objectContaining({ id: 'comment-1' }),
        ['reporter-1'],
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1'],
        expect.objectContaining({
          ticketId: 'ticket-1',
          message: expect.stringContaining(staffUser.name),
        }),
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
        expect.objectContaining({
          ticketId: 'ticket-1',
          message: expect.any(String),
        }),
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

    it('pausa el SLA al pasar a ON_HOLD', async () => {
      prisma.ticket.findUnique.mockResolvedValue(baseTicket);
      prisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        status: 'ON_HOLD',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { status: 'ON_HOLD' } as UpdateTicketDto,
        staffUser,
      );

      const data = prisma.ticket.update.mock.calls[0][0].data;
      expect(data.onHoldSince).toBeInstanceOf(Date);
      expect(data.dueAt).toBeUndefined();
    });

    it('al reanudar suma a dueAt el tiempo hábil en pausa y lo acumula', async () => {
      const dueAt = new Date('2026-10-23T23:00:00.000Z'); // viernes 17:00 MX
      const onHoldSince = new Date(Date.now() - 2 * 60 * 60 * 1000);
      prisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        status: 'ON_HOLD',
        dueAt,
        onHoldSince,
        slaPausedSeconds: 600,
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
      const pausedMs = businessTimeBetween(onHoldSince, new Date());
      expect(data.dueAt.getTime()).toBeCloseTo(
        addBusinessTime(dueAt, pausedMs).getTime(),
        -4,
      );
      expect(data.slaPausedSeconds).toBeGreaterThanOrEqual(
        600 + Math.floor(pausedMs / 1000) - 2,
      );
      expect(data.onHoldSince).toBeNull();
    });

    it('al cambiar la prioridad conserva el tiempo ya pausado', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...baseTicket,
        slaPausedSeconds: 3600,
      });
      prisma.ticket.update.mockResolvedValue({
        ...baseTicket,
        priority: 'HIGH',
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await service.update(
        'ticket-1',
        { priority: 'HIGH' } as UpdateTicketDto,
        staffUser,
      );

      const data = prisma.ticket.update.mock.calls[0][0].data;
      // HIGH = 8 h hábiles desde createdAt, más 1 h hábil en pausa.
      expect(data.dueAt).toEqual(
        computeDueAt('HIGH', baseTicket.createdAt, 60 * 60 * 1000),
      );
    });

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
      // 4 business hours from createdAt (business-hours.spec covers the calendar).
      expect(data.dueAt).toEqual(
        computeDueAt('CRITICAL', baseTicket.createdAt),
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

  describe('filtros de formulario en la bandeja', () => {
    it('PENDING lista formularios sin decidir de tickets abiertos', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(0);

      await service.findAll(
        {
          page: 1,
          limit: 10,
          formType: 'STUDY_CREATE',
          formStatus: 'PENDING',
        } as FindTicketsDto,
        scopedStaffUser,
      );

      const where = prisma.ticket.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { form: { type: 'STUDY_CREATE' } },
          {
            form: { appliedAt: null, rejectedAt: null },
            status: { notIn: ['CLOSED', 'CANCELLED'] },
          },
        ]),
      );
    });
  });
});
