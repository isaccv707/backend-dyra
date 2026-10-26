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
  let mailQueue: TicketsTestContext['mailQueue'];
  let commentsService: TicketCommentsService;
  let notificationsService: TicketNotificationsService;

  beforeEach(async () => {
    ({ prisma, gateway, mailQueue, commentsService, notificationsService } =
      await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

  describe('dispatch (reglas por evento)', () => {
    const ticket = {
      id: 'ticket-1',
      code: 42,
      title: 'No enciende el monitor',
      branchId,
      createdById: 'reporter-1',
      assigneeIds: ['tech-1'],
    };
    const emails = [
      { id: 'reporter-1', email: 'reporter@dyra.com' },
      { id: 'tech-1', email: 'tech@dyra.com' },
    ];

    it('RESOLVED: aviso a creador y asignados, correo solo al creador', async () => {
      prisma.user.findMany.mockResolvedValue([emails[0]]);

      await notificationsService.dispatch('RESOLVED', ticket, {
        message: 'TI resolvió el ticket.',
        actorId: 'tech-1',
      });

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1'],
        expect.objectContaining({ kind: 'CHANGE' }),
      );
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['reporter-1'] }, isActive: true },
        select: { id: true, email: true },
      });
      expect(mailQueue.enqueue).toHaveBeenCalledWith({
        type: 'ticketUpdate',
        to: 'reporter@dyra.com',
        data: expect.objectContaining({
          heading: 'Tu ticket fue resuelto',
          message: expect.stringMatching(
            /^TI resolvió el ticket\.\n\n.*se cerrará automáticamente/s,
          ),
        }),
      });
    });

    it('CHANGE: solo aviso in-app, sin correo ni TI', async () => {
      await notificationsService.dispatch('CHANGE', ticket, {
        message: 'cambió la prioridad',
        actorId: 'staff-1',
      });

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        expect.objectContaining({ kind: 'CHANGE' }),
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(mailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('FORM_DECIDED: correo al creador', async () => {
      prisma.user.findMany.mockResolvedValue([emails[0]]);

      await notificationsService.dispatch('FORM_DECIDED', ticket, {
        message: 'aprobó la solicitud',
        actorId: 'staff-1',
      });

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        expect.objectContaining({ kind: 'FORM' }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'reporter@dyra.com' }),
      );
    });

    it('no manda correo a usuarios inactivos', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await notificationsService.dispatch('RESOLVED', ticket, {
        message: 'resuelto',
        actorId: 'tech-1',
      });

      expect(mailQueue.enqueue).not.toHaveBeenCalled();
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
});
