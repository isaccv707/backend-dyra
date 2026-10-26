import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SetTicketAssigneesDto } from '../dto/set-ticket-assignees.dto';
import { TicketAssigneesService } from '../assignees/ticket-assignees.service';
import {
  createTicketsTestContext,
  branchId,
  staffUser,
  scopedStaffUser,
  TicketsTestContext,
} from '../testing/tickets-test-context';

describe('TicketAssigneesService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let mailQueue: TicketsTestContext['mailQueue'];
  let assigneesService: TicketAssigneesService;

  beforeEach(async () => {
    ({ prisma, gateway, mailQueue, assigneesService } =
      await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

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
      prisma.user.findMany
        // assignee validation, TI of the branch, emails of the new assignees
        .mockResolvedValueOnce([activeUser('new-1', 'María')])
        .mockResolvedValueOnce([{ id: 'ti-9', email: 'ti9@dyra.com' }])
        .mockResolvedValueOnce([{ id: 'new-1', email: 'new-1@dyra.com' }]);
      const updated = {
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      };
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await assigneesService.setAssignees(
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
      // Participants, TI of the branch and whoever was removed; not the actor.
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'new-1', 'ti-9', 'old-1'],
        expect.objectContaining({
          ticketId: 'ticket-1',
          kind: 'ASSIGNMENT',
          message: expect.any(String),
        }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mailQueue.enqueue).toHaveBeenCalledWith({
        type: 'ticketAssigned',
        to: 'new-1@dyra.com',
        data: {
          ticketId: 'ticket-1',
          code: 42,
          title: 'No enciende el monitor',
          priorityLabel: 'Alta',
          branchName: 'Sucursal 1',
          assignedByName: staffUser.name,
        },
      });
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

      await assigneesService.setAssignees(
        'ticket-1',
        setDto(['new-1']),
        staffUser,
      );

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

      await assigneesService.setAssignees(
        'ticket-1',
        setDto(['old-1']),
        staffUser,
      );

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
      expect(mailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('el correo se encola: la asignación no espera al SMTP', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ ...ticket, assignees: [] });
      prisma.user.findMany.mockResolvedValue([activeUser('new-1', 'María')]);
      const updated = {
        id: 'ticket-1',
        assignees: [{ user: { id: 'new-1' } }],
      };
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(updated);

      await expect(
        assigneesService.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).resolves.toBe(updated);
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ticketAssigned' }),
      );
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        assigneesService.setAssignees('missing', setDto([]), staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si TI no tiene acceso a la sucursal del ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticket,
        branchId: 'other-branch',
      });

      await expect(
        assigneesService.setAssignees('ticket-1', setDto([]), scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si un usuario a asignar no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        assigneesService.setAssignees(
          'ticket-1',
          setDto(['ghost-1']),
          staffUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si se intenta asignar a quien reportó el ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        activeUser('reporter-1', 'Reportero'),
      ]);

      await expect(
        assigneesService.setAssignees(
          'ticket-1',
          setDto(['reporter-1']),
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si un usuario a asignar está inactivo', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        { ...activeUser('new-1', 'María'), isActive: false },
      ]);

      await expect(
        assigneesService.setAssignees('ticket-1', setDto(['new-1']), staffUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si un usuario a asignar no tiene acceso a la sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.user.findMany.mockResolvedValue([
        { ...activeUser('new-1', 'María'), branches: [{ id: 'other-branch' }] },
      ]);

      await expect(
        assigneesService.setAssignees('ticket-1', setDto(['new-1']), staffUser),
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
        assigneesService.setAssignees('ticket-1', setDto(['new-1']), staffUser),
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

      const result = await assigneesService.findAssignableUsers(
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

      await assigneesService.findAssignableUsers(
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
        assigneesService.findAssignableUsers('missing', {}, staffUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si TI no tiene acceso a la sucursal del ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        ...ticket,
        branchId: 'other-branch',
      });

      await expect(
        assigneesService.findAssignableUsers('ticket-1', {}, scopedStaffUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
