import { TicketSlaService } from './ticket-sla.service';
import {
  branchId,
  createTicketsTestContext,
  TicketsTestContext,
} from '../testing/tickets-test-context';

// America/Mexico_City is UTC-6 all year (no daylight saving since 2022).
const mx = (iso: string) => new Date(`${iso}-06:00`);

describe('TicketSlaService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let mailQueue: TicketsTestContext['mailQueue'];
  let slaService: TicketSlaService;

  beforeEach(async () => {
    ({ prisma, gateway, mailQueue, slaService } =
      await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

  describe('notifyOverdueTickets', () => {
    const overdueTicket = {
      id: 'ticket-1',
      code: 42,
      title: 'No enciende el monitor',
      branchId,
      createdById: 'reporter-1',
      assignees: [{ userId: 'tech-1' }],
    };

    it('reclama cada ticket vencido, avisa al creador y a los asignados y transmite a TI de su sucursal', async () => {
      prisma.ticket.findMany.mockResolvedValue([overdueTicket]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([
        { id: 'tech-1', email: 'tech@dyra.com' },
      ]);

      const result = await slaService.notifyOverdueTickets();

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          }),
        }),
      );
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 'ticket-1', overdueNotifiedAt: null },
        data: { overdueNotifiedAt: expect.any(Date) },
      });
      expect(prisma.ticketNotification.createMany).toHaveBeenCalledWith({
        data: ['reporter-1', 'tech-1'].map((userId) => ({
          userId,
          ticketId: 'ticket-1',
          kind: 'OVERDUE',
          message: expect.stringContaining('#42'),
        })),
      });
      // Email only to whoever must act: the assignees.
      expect(mailQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mailQueue.enqueue).toHaveBeenCalledWith({
        type: 'ticketUpdate',
        to: 'tech@dyra.com',
        data: expect.objectContaining({ ticketId: 'ticket-1', code: 42 }),
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

      const result = await slaService.notifyOverdueTickets();

      expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
      expect(gateway.emitOverdueTicket).not.toHaveBeenCalled();
      expect(result).toEqual({ notified: 0 });
    });

    it('no hace nada si no hay tickets vencidos', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      const result = await slaService.notifyOverdueTickets();

      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ notified: 0 });
    });
  });

  describe('warnSlaAboutToExpire', () => {
    // Lunes 26/10/2026 10:00; CRITICAL = 4 h hábiles → avisa con ≤ 1 h restante.
    const now = mx('2026-10-26T10:00:00');
    const ticket = (dueAt: Date, assignees: { userId: string }[] = []) => ({
      id: 'ticket-1',
      code: 42,
      title: 'Sin internet',
      branchId,
      createdById: 'reporter-1',
      priority: 'CRITICAL',
      dueAt,
      assignees,
    });

    it('al 75% del SLA avisa a TI si no hay asignados (in-app y correo)', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        ticket(mx('2026-10-26T10:30:00')),
      ]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([
        { id: 'ti-9', email: 'ti9@dyra.com' },
      ]);

      const result = await slaService.warnSlaAboutToExpire(now);

      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 'ticket-1', slaWarnedAt: null },
        data: { slaWarnedAt: now },
      });
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['ti-9'],
        expect.objectContaining({ kind: 'SLA_WARNING' }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ti9@dyra.com' }),
      );
      expect(result).toEqual({ warned: 1 });
    });

    it('con asignados, el aviso es para ellos', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        ticket(mx('2026-10-26T10:30:00'), [{ userId: 'tech-1' }]),
      ]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([
        { id: 'tech-1', email: 'tech@dyra.com' },
      ]);

      await slaService.warnSlaAboutToExpire(now);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['tech-1'],
        expect.objectContaining({ kind: 'SLA_WARNING' }),
      );
    });

    it('no avisa si queda más del 25% del SLA', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        ticket(mx('2026-10-26T13:00:00')),
      ]);

      const result = await slaService.warnSlaAboutToExpire(now);

      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ warned: 0 });
    });
  });

  describe('escalateUnassignedOverdue', () => {
    const ticket = {
      id: 'ticket-1',
      code: 42,
      title: 'Sin internet',
      branchId,
      createdById: 'reporter-1',
      priority: 'CRITICAL',
      dueAt: mx('2026-10-26T09:00:00'),
      assignees: [],
    };

    it('escala a los administradores tras 2 h hábiles vencido sin asignar', async () => {
      prisma.ticket.findMany.mockResolvedValue([ticket]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', email: 'admin@dyra.com' },
      ]);

      const result = await slaService.escalateUnassignedOverdue(
        mx('2026-10-26T11:30:00'),
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: { name: 'Administrador' } }),
        }),
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['admin-1'],
        expect.objectContaining({ kind: 'ESCALATION' }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@dyra.com' }),
      );
      expect(result).toEqual({ escalated: 1 });
    });

    it('espera a cumplir las horas hábiles de gracia', async () => {
      prisma.ticket.findMany.mockResolvedValue([ticket]);

      const result = await slaService.escalateUnassignedOverdue(
        mx('2026-10-26T10:00:00'),
      );

      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ escalated: 0 });
    });
  });

  describe('autoCloseResolved', () => {
    const resolved = {
      id: 'ticket-1',
      code: 42,
      title: 'Sin internet',
      branchId,
      createdById: 'reporter-1',
      status: 'RESOLVED',
      priority: 'MEDIUM',
      // Viernes 23/10 10:00 + 3 días hábiles = martes 27/10 10:00
      resolvedAt: mx('2026-10-23T10:00:00'),
      closedAt: null,
      reopenedCount: 0,
      slaPausedSeconds: 0,
      onHoldSince: null,
      dueAt: null,
      createdAt: mx('2026-10-22T10:00:00'),
    };

    it('cierra el ticket a los 3 días hábiles sin respuesta, como sistema', async () => {
      prisma.ticket.findMany.mockResolvedValue([resolved]);
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({
        id: 'ticket-1',
        assignees: [{ user: { id: 'tech-1' } }],
      });
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'reporter-1', email: 'reporter@dyra.com' },
      ]);

      const result = await slaService.autoCloseResolved(
        mx('2026-10-27T10:00:00'),
      );

      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 'ticket-1', status: 'RESOLVED' },
        data: expect.objectContaining({
          status: 'CLOSED',
          closedAt: expect.any(Date),
        }),
      });
      expect(prisma.ticketComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            authorId: null,
            isSystem: true,
            body: expect.stringMatching(/^Se cerró automáticamente/),
          }),
        }),
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        expect.objectContaining({ kind: 'CHANGE' }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'reporter@dyra.com' }),
      );
      expect(gateway.emitTicketUpdated).toHaveBeenCalled();
      expect(result).toEqual({ closed: 1 });
    });

    it('no cierra antes de cumplir los días hábiles', async () => {
      prisma.ticket.findMany.mockResolvedValue([resolved]);

      const result = await slaService.autoCloseResolved(
        mx('2026-10-26T18:00:00'),
      );

      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ closed: 0 });
    });
  });
});
