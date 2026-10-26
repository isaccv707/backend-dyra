import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreateTicketCommentDto } from '../dto/create-ticket-comment.dto';
import { TicketCommentsService } from '../comments/ticket-comments.service';
import { TicketNotificationsService } from '../notifications/ticket-notifications.service';
import {
  createTicketsTestContext,
  branchId,
  globalUser,
  staffUser,
  TicketsTestContext,
} from '../testing/tickets-test-context';

describe('TicketNotificationsService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let commentsService: TicketCommentsService;
  let notificationsService: TicketNotificationsService;

  beforeEach(async () => {
    ({ prisma, gateway, commentsService, notificationsService } =
      await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

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

      await commentsService.addComment('ticket-1', commentDto, staffUser);

      expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 'reporter-1',
            ticketId: 'ticket-1',
            kind: 'COMMENT',
            actorId: staffUser.id,
            message: expect.stringContaining(staffUser.name),
          }),
          expect.objectContaining({
            userId: 'tech-1',
            ticketId: 'ticket-1',
            message: expect.stringContaining(staffUser.name),
          }),
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

      await commentsService.addComment('ticket-1', commentDto, staffUser);

      expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('findMine', () => {
    it('filtra por el usuario autenticado y por read cuando se manda', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await notificationsService.findMine(
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

  describe('markRead', () => {
    it('marca como leída una notificación propia', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: staffUser.id,
      });
      prisma.ticketNotification.update.mockResolvedValue({
        id: 'notif-1',
        read: true,
      });

      const result = await notificationsService.markRead('notif-1', staffUser);

      expect(prisma.ticketNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { read: true },
      });
      expect(result).toEqual({ id: 'notif-1', read: true });
    });

    it('lanza NotFoundException si la notificación no existe', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue(null);

      await expect(
        notificationsService.markRead('missing', staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si la notificación es de otro usuario', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'someone-else',
      });

      await expect(
        notificationsService.markRead('notif-1', staffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketNotification.update).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('marca como leídas todas las notificaciones pendientes del usuario', async () => {
      prisma.ticketNotification.updateMany.mockResolvedValue({ count: 3 });

      const result = await notificationsService.markAllRead(staffUser);

      expect(prisma.ticketNotification.updateMany).toHaveBeenCalledWith({
        where: { userId: staffUser.id, read: false },
        data: { read: true },
      });
      expect(result).toEqual({ updated: 3 });
    });
  });

  describe('purga de notificaciones', () => {
    it('el usuario borra sus leídas, o todas con all', async () => {
      prisma.ticketNotification.deleteMany.mockResolvedValue({ count: 3 });

      await expect(notificationsService.purgeMine(globalUser)).resolves.toEqual(
        {
          deleted: 3,
        },
      );
      expect(prisma.ticketNotification.deleteMany).toHaveBeenCalledWith({
        where: { userId: globalUser.id, read: true },
      });

      await notificationsService.purgeMine(globalUser, true);
      expect(prisma.ticketNotification.deleteMany).toHaveBeenLastCalledWith({
        where: { userId: globalUser.id },
      });
    });

    it('no deja borrar notificaciones ajenas', async () => {
      prisma.ticketNotification.findUnique.mockResolvedValue({
        userId: 'other',
      });

      await expect(
        notificationsService.remove('n-1', globalUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketNotification.delete).not.toHaveBeenCalled();
    });

    it('el cron borra solo las leídas de más de 90 días', async () => {
      prisma.ticketNotification.deleteMany.mockResolvedValue({ count: 1 });
      const now = new Date('2026-10-22T00:00:00.000Z');

      await notificationsService.purgeOld(now);

      expect(prisma.ticketNotification.deleteMany).toHaveBeenCalledWith({
        where: {
          read: true,
          createdAt: { lt: new Date('2026-07-24T00:00:00.000Z') },
        },
      });
    });
  });

  describe('notifyOverdueTickets', () => {
    const overdueTicket = {
      id: 'ticket-1',
      code: 42,
      title: 'No enciende el monitor',
      branchId,
      createdById: 'reporter-1',
    };

    it('reclama cada ticket vencido, avisa al creador y transmite a TI de su sucursal', async () => {
      prisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });

      const result = await notificationsService.notifyOverdueTickets();

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { notIn: ['ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'] },
          }),
        }),
      );
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 'ticket-1', overdueNotifiedAt: null },
        data: { overdueNotifiedAt: expect.any(Date) },
      });
      expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'reporter-1',
            ticketId: 'ticket-1',
            kind: 'OVERDUE',
            message: expect.stringContaining('#42'),
          },
        ],
      });
      expect(gateway.emitOverdueTicket).toHaveBeenCalledWith({
        id: 'ticket-1',
        code: 42,
        title: 'No enciende el monitor',
        branchId,
      });
      expect(result).toEqual({ notified: 1 });
    });

    it('no repite el aviso si otra instancia ya reclamó el ticket', async () => {
      prisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 0 });

      const result = await notificationsService.notifyOverdueTickets();

      expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
      expect(gateway.emitOverdueTicket).not.toHaveBeenCalled();
      expect(result).toEqual({ notified: 0 });
    });

    it('no hace nada si no hay tickets vencidos', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      const result = await notificationsService.notifyOverdueTickets();

      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ notified: 0 });
    });
  });
});
