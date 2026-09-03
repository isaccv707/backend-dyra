import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { TicketsService } from './tickets.service';
import { TicketsGateway } from './tickets.gateway';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { RequestUser } from 'src/auth/interfaces/request-user.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateTicketCommentDto } from './dto/create-ticket-comment.dto';
import { AttachmentDto } from './dto/attachment.dto';

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
    ticketAttachment: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let gateway: {
    emitNewTicket: jest.Mock;
    emitTicketUpdated: jest.Mock;
    emitNewComment: jest.Mock;
    notifyUsers: jest.Mock;
  };
  let cloudinary: { generateSignedUploadParams: jest.Mock };

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
      ticketAttachment: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    gateway = {
      emitNewTicket: jest.fn(),
      emitTicketUpdated: jest.fn(),
      emitNewComment: jest.fn(),
      notifyUsers: jest.fn(),
    };
    cloudinary = { generateSignedUploadParams: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TicketsGateway, useValue: gateway },
        { provide: CloudinaryService, useValue: cloudinary },
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

    it('crea los attachments anidados cuando vienen en el dto', async () => {
      const attachments = [
        {
          url: 'https://cdn.dyra.com/tickets/foto.png',
          fileName: 'foto.png',
          fileType: 'image/png',
        },
      ];
      prisma.ticket.create.mockResolvedValue({ id: 'ticket-1' });

      await service.create({ ...createDto, attachments }, globalUser);

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: { create: attachments },
          }),
        }),
      );
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

    it('restringe la búsqueda a las sucursales del usuario cuando no manda branchId', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({} as FindTicketsDto, scopedUser);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: { in: [branchId] } }),
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
      const ticket = { id: 'ticket-1', branchId, comments: [publicComment] };
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result).toEqual({ ...ticket, comments: [publicComment] });
    });

    it('oculta las notas internas a un usuario sin el permiso tickets:update', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        comments: [internalComment, publicComment],
      });

      const result = await service.findOne('ticket-1', scopedUser);

      expect(result.comments).toEqual([publicComment]);
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

    it('lanza ForbiddenException si el ticket pertenece a otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId: 'other-branch',
      });

      await expect(
        service.findOne('ticket-1', scopedUser),
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
      );
      expect(gateway.notifyUsers).toHaveBeenCalledWith(
        ['reporter-1', null],
        'ticket-1',
        expect.stringContaining(staffUser.name),
      );
    });

    it('menciona al nuevo responsable cuando se reasigna el ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(existingTicket);
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
      expect(gateway.emitNewComment).toHaveBeenCalledWith('ticket-1', created);
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
      prisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1', branchId });

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
  });

  describe('addAttachment', () => {
    const attachmentDto: AttachmentDto = {
      url: 'https://cdn.dyra.com/tickets/foto.png',
      fileName: 'foto.png',
      fileType: 'image/png',
    };

    it('agrega el adjunto al ticket existente', async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1', branchId });
      const created = { id: 'attachment-1', ...attachmentDto };
      prisma.ticketAttachment.create.mockResolvedValue(created);

      const result = await service.addAttachment(
        'ticket-1',
        attachmentDto,
        scopedUser,
      );

      expect(prisma.ticketAttachment.create).toHaveBeenCalledWith({
        data: { ...attachmentDto, ticketId: 'ticket-1' },
      });
      expect(result).toBe(created);
    });

    it('lanza NotFoundException si el ticket no existe', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.addAttachment('missing', attachmentDto, globalUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza ForbiddenException si el ticket pertenece a otra sucursal', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId: 'other-branch',
      });

      await expect(
        service.addAttachment('ticket-1', attachmentDto, scopedUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ticketAttachment.create).not.toHaveBeenCalled();
    });
  });

  describe('createUploadSignature', () => {
    it('pide a CloudinaryService una firma pública (type: upload, resourceType: auto)', () => {
      const signed = { cloudName: 'dyra', signature: 'abc' };
      cloudinary.generateSignedUploadParams.mockReturnValue(signed);

      const result = service.createUploadSignature();

      expect(cloudinary.generateSignedUploadParams).toHaveBeenCalledWith(
        expect.stringMatching(/^tickets\/attachment-/),
        { resourceType: 'auto', type: 'upload' },
      );
      expect(result).toBe(signed);
    });
  });
});
