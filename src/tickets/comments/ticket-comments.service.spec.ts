import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CreateTicketCommentDto } from '../dto/create-ticket-comment.dto';
import {
  changeEventOf,
  TicketCommentsService,
} from '../comments/ticket-comments.service';
import {
  createTicketsTestContext,
  branchId,
  globalUser,
  scopedUser,
  staffUser,
  TicketsTestContext,
} from '../testing/tickets-test-context';

describe('TicketCommentsService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let mailQueue: TicketsTestContext['mailQueue'];
  let commentsService: TicketCommentsService;

  beforeEach(async () => {
    ({ prisma, gateway, mailQueue, commentsService } =
      await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

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

      const result = await commentsService.addComment(
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
      expect(gateway.emitNewComment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ticket-1' }),
        created,
        ['reporter-1', 'tech-1'],
      );
      expect(result).toBe(created);
    });

    it('avisa al creador y al asignado (pero no al autor del comentario)', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await commentsService.addComment('ticket-1', commentDto, staffUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        expect.objectContaining({
          ticketId: 'ticket-1',
          message: expect.stringContaining(staffUser.name),
        }),
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

      await commentsService.addComment('ticket-1', commentDto, scopedUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['tech-1'],
        expect.objectContaining({
          ticketId: 'ticket-1',
          message: expect.any(String),
        }),
      );
    });

    it('avisa también a TI de la sucursal en comentarios públicos', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'ti-9', email: 'ti9@dyra.com' },
        { id: staffUser.id, email: staffUser.email },
      ]);

      await commentsService.addComment('ticket-1', commentDto, staffUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1', 'ti-9'],
        expect.objectContaining({ kind: 'COMMENT' }),
      );
      expect(mailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('una nota interna solo avisa a TI, nunca a quien reportó', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: true,
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'ti-9', email: 'ti9@dyra.com' },
        { id: staffUser.id, email: staffUser.email },
      ]);

      await commentsService.addComment(
        'ticket-1',
        { ...commentDto, isInternal: true },
        staffUser,
      );

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['ti-9'],
        expect.objectContaining({
          kind: 'COMMENT',
          message: expect.stringContaining('nota interna'),
        }),
      );
      expect(mailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('permite isInternal:true cuando el usuario tiene el permiso tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticketWithParties);
      prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });

      await commentsService.addComment(
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
        commentsService.addComment(
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
        commentsService.addComment('missing', commentDto, globalUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si el ticket pertenece a otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        assignees: [],
        branchId: 'other-branch',
      });

      await expect(
        commentsService.addComment('ticket-1', commentDto, scopedUser),
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
        commentsService.addComment('ticket-1', commentDto, scopedUser),
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

      await commentsService.addComment('ticket-1', commentDto, scopedUser);

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-2'],
        expect.objectContaining({
          ticketId: 'ticket-1',
          message: expect.any(String),
        }),
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
        commentsService.addComment(
          'ticket-1',
          { ...commentDto, isInternal: true },
          scopedUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
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

      await commentsService.addComment(
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

      await commentsService.addComment(
        'ticket-1',
        { body: 'Aviso' },
        scopedUser,
      );

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

      await commentsService.addComment(
        'ticket-1',
        { body: 'Otro comentario' },
        staffUser,
      );

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('respuesta del creador a un ticket resuelto', () => {
    it('reabre el ticket (IN_PROGRESS) y lo registra', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        code: 42,
        title: 'Sin internet',
        branchId,
        createdById: scopedUser.id,
        status: 'RESOLVED',
        priority: 'MEDIUM',
        resolvedAt: new Date(),
        reopenedCount: 0,
        slaPausedSeconds: 0,
        firstResponseAt: new Date(),
        assignees: [{ userId: 'tech-1' }],
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });
      prisma.ticket.update.mockResolvedValue({ id: 'ticket-1' });

      await commentsService.addComment(
        'ticket-1',
        { body: 'Sigue sin funcionar' },
        scopedUser,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({
            status: 'IN_PROGRESS',
            resolvedAt: null,
            reopenedCount: 1,
          }),
        }),
      );
      expect(prisma.ticketEvent.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ type: 'REOPENED' }),
        ]),
      });
      expect(gateway.emitTicketUpdated).toHaveBeenCalled();
    });

    it('una respuesta de TI no lo reabre', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        createdById: 'reporter-1',
        status: 'RESOLVED',
        firstResponseAt: new Date(),
        assignees: [],
      });
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });

      await commentsService.addComment('ticket-1', { body: 'Ok' }, staffUser);

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('changeEventOf', () => {
    const entry = (type: string, toValue: string | null = null) =>
      ({ type, fromValue: null, toValue, text: '' }) as Parameters<
        typeof changeEventOf
      >[0][number];

    it.each([
      [
        [entry('FORM_APPLIED'), entry('STATUS_CHANGED', 'RESOLVED')],
        'FORM_DECIDED',
      ],
      [
        [entry('FORM_REJECTED'), entry('STATUS_CHANGED', 'CANCELLED')],
        'FORM_DECIDED',
      ],
      [[entry('FORM_UPDATED')], 'FORM_UPDATED'],
      [[entry('ASSIGNED'), entry('UNASSIGNED')], 'ASSIGNMENT'],
      [[entry('STATUS_CHANGED', 'RESOLVED')], 'RESOLVED'],
      [
        [entry('STATUS_CHANGED', 'IN_PROGRESS'), entry('PRIORITY_CHANGED')],
        'CHANGE',
      ],
    ])('%#: %s', (entries, event) => {
      expect(changeEventOf(entries)).toBe(event);
    });
  });

  describe('menciones', () => {
    const ticket = {
      id: 'ticket-1',
      code: 42,
      title: 'Sin internet',
      branchId,
      createdById: 'reporter-1',
      status: 'IN_PROGRESS',
      firstResponseAt: new Date(),
      assignees: [{ userId: 'tech-1' }],
    };

    beforeEach(() => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);
      prisma.ticketComment.create.mockResolvedValue({
        id: 'comment-1',
        isInternal: false,
      });
    });

    it('avisa al mencionado con MENTION y no le duplica el aviso del comentario', async () => {
      prisma.user.findMany
        // TI of the branch, then the active mentionable users
        .mockResolvedValueOnce([{ id: 'ti-9', email: 'ti9@dyra.com' }])
        .mockResolvedValueOnce([
          { id: 'reporter-1', name: 'Reportero' },
          { id: 'tech-1', name: 'Técnico' },
          { id: 'ti-9', name: 'TI 9' },
        ])
        .mockResolvedValue([{ id: 'ti-9', email: 'ti9@dyra.com' }]);

      await commentsService.addComment(
        'ticket-1',
        { body: 'Revisa esto', mentionedUserIds: ['ti-9'] },
        staffUser,
      );

      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', 'tech-1'],
        expect.objectContaining({ kind: 'COMMENT' }),
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['ti-9'],
        expect.objectContaining({
          kind: 'COMMENT',
          message: expect.stringContaining('te mencionó'),
        }),
      );
      expect(mailQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ti9@dyra.com' }),
      );
    });

    it('rechaza mencionar a alguien ajeno al ticket', async () => {
      prisma.user.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'reporter-1', name: 'Reportero' }]);

      await expect(
        commentsService.addComment(
          'ticket-1',
          { body: 'Hola', mentionedUserIds: ['stranger-1'] },
          staffUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.ticketComment.create).not.toHaveBeenCalled();
    });

    it('en una nota interna no se puede mencionar a quien reportó', async () => {
      prisma.user.findMany
        .mockResolvedValueOnce([{ id: 'ti-9', email: 'ti9@dyra.com' }])
        .mockResolvedValueOnce([{ id: 'ti-9', name: 'TI 9' }]);

      await expect(
        commentsService.addComment(
          'ticket-1',
          { body: 'Nota', isInternal: true, mentionedUserIds: ['reporter-1'] },
          staffUser,
        ),
      ).rejects.toThrow('solo puedes mencionar a TI');
    });
  });
});
