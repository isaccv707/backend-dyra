import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma/prisma.service';
import {
  TI_GLOBAL_ROOM,
  TicketsGateway,
  toSocketTicket,
} from './tickets.gateway';

describe('TicketsGateway', () => {
  let gateway: TicketsGateway;
  let jwtService: { verify: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock; findMany: jest.Mock } };

  const createMockSocket = (overrides: Record<string, unknown> = {}) => {
    const rooms = new Set<string>(['socket-id']);
    return {
      data: {},
      rooms,
      handshake: { auth: {}, headers: {} },
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn((room: string) => {
        rooms.add(room);
        return Promise.resolve();
      }),
      leave: jest.fn((room: string) => {
        rooms.delete(room);
        return Promise.resolve();
      }),
      ...overrides,
    };
  };

  const mockServer = () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as any;
    return { to, emit };
  };

  const tiUser = (branches: string[], permissions = ['tickets:update']) => ({
    id: 'user-1',
    isActive: true,
    role: { permissions: permissions.map((action) => ({ action })) },
    branches: branches.map((id) => ({ id })),
  });

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    prisma = { user: { findUnique: jest.fn(), findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get(TicketsGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('handleConnection', () => {
    it('autentica el socket con el token de handshake.auth y lo une a su sala personal', async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@dyra.com' });
      prisma.user.findUnique.mockResolvedValue(tiUser(['branch-a']));

      await gateway.handleConnection(client as any);

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(client.data).toMatchObject({ userId: 'user-1' });
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      // La sala de TI solo se une con join_ti_room.
      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('autentica el socket con el token del header Authorization: Bearer', async () => {
      const client = createMockSocket({
        handshake: {
          auth: {},
          headers: { authorization: 'Bearer header-token' },
        },
      });
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@dyra.com' });
      prisma.user.findUnique.mockResolvedValue(tiUser([]));

      await gateway.handleConnection(client as any);

      expect(jwtService.verify).toHaveBeenCalledWith('header-token');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('desconecta el socket cuando expira su token', async () => {
      jest.useFakeTimers();
      const client = createMockSocket({
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'a@dyra.com',
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      prisma.user.findUnique.mockResolvedValue(tiUser([]));

      await gateway.handleConnection(client as any);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(61_000);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('desconecta el socket si no viene ningún token', async () => {
      const client = createMockSocket();

      await gateway.handleConnection(client as any);

      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('desconecta el socket si el token es inválido o expiró', async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 'bad-token' }, headers: {} },
      });
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await gateway.handleConnection(client as any);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('desconecta el socket si el usuario no existe o está inactivo', async () => {
      for (const user of [null, { ...tiUser([]), isActive: false }]) {
        const client = createMockSocket({
          handshake: { auth: { token: 'valid-token' }, headers: {} },
        });
        jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a' });
        prisma.user.findUnique.mockResolvedValue(user);

        await gateway.handleConnection(client as any);

        expect(client.disconnect).toHaveBeenCalledWith(true);
      }
    });
  });

  describe('handleJoinTiRoom', () => {
    it('une a TI solo a las salas de sus sucursales, leyendo los permisos actuales', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.user.findUnique.mockResolvedValue(
        tiUser(['branch-a', 'branch-b']),
      );

      await gateway.handleJoinTiRoom(client as any);

      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect([...client.rooms]).toEqual(
        expect.arrayContaining(['ti:branch-a', 'ti:branch-b']),
      );
      expect(client.rooms.has(TI_GLOBAL_ROOM)).toBe(false);
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('espera a que termine la autenticación si join_ti_room llega primero', async () => {
      const client = createMockSocket({
        id: 'socket-1',
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@dyra.com' });
      let releaseUser: (value: unknown) => void = () => undefined;
      prisma.user.findUnique
        .mockImplementationOnce(
          () => new Promise((resolve) => (releaseUser = resolve)),
        )
        .mockResolvedValue(tiUser(['branch-a']));

      const connecting = gateway.handleConnection(client as any);
      const joining = gateway.handleJoinTiRoom(client as any);
      releaseUser(tiUser(['branch-a']));
      await Promise.all([connecting, joining]);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.rooms.has('ti:branch-a')).toBe(true);
    });

    it('un usuario de TI sin sucursales (global) entra a la sala global', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.user.findUnique.mockResolvedValue(tiUser([]));

      await gateway.handleJoinTiRoom(client as any);

      expect(client.join).toHaveBeenCalledWith(TI_GLOBAL_ROOM);
    });

    it('rechaza con un evento error cuando ya no tiene el permiso', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.user.findUnique.mockResolvedValue(
        tiUser(['branch-a'], ['tickets:create']),
      );

      await gateway.handleJoinTiRoom(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No tienes permisos para unirte a la sala de TI',
      });
    });

    it('desconecta si la cuenta se desactivó', async () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });
      prisma.user.findUnique.mockResolvedValue({
        ...tiUser(['branch-a']),
        isActive: false,
      });

      await gateway.handleJoinTiRoom(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('revalidateSockets', () => {
    it('saca de las salas de TI a quien perdió el permiso o cambió de sucursal, y desconecta cuentas inactivas', async () => {
      const lostPermission = createMockSocket({
        data: { userId: 'user-1', wantsTiRoom: true },
      });
      lostPermission.rooms.add('ti:branch-a');
      const movedBranch = createMockSocket({
        data: { userId: 'user-2', wantsTiRoom: true },
      });
      movedBranch.rooms.add('ti:branch-a');
      const deactivated = createMockSocket({ data: { userId: 'user-3' } });

      gateway.server = {
        fetchSockets: jest
          .fn()
          .mockResolvedValue([lostPermission, movedBranch, deactivated]),
      } as any;
      prisma.user.findMany.mockResolvedValue([
        { ...tiUser(['branch-a'], ['tickets:create']), id: 'user-1' },
        { ...tiUser(['branch-b']), id: 'user-2' },
        { ...tiUser([]), id: 'user-3', isActive: false },
      ]);

      await gateway.revalidateSockets();

      expect(lostPermission.rooms.has('ti:branch-a')).toBe(false);
      expect(movedBranch.rooms.has('ti:branch-a')).toBe(false);
      expect(movedBranch.rooms.has('ti:branch-b')).toBe(true);
      expect(deactivated.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('emisiones a TI', () => {
    it('ticket_created y ticket_updated van solo a TI de la sucursal del ticket (y a TI global)', () => {
      const { to, emit } = mockServer();
      const ticket = { id: 'ticket-1', branchId: 'branch-a' } as any;

      gateway.emitNewTicket(ticket);
      gateway.emitTicketUpdated(ticket);

      expect(to).toHaveBeenNthCalledWith(1, ['ti:branch-a', TI_GLOBAL_ROOM]);
      expect(to).toHaveBeenNthCalledWith(2, ['ti:branch-a', TI_GLOBAL_ROOM]);
      expect(emit).toHaveBeenCalledWith('ticket_created', ticket);
      expect(emit).toHaveBeenCalledWith('ticket_updated', ticket);
    });

    it('el ticket viaja sin los datos ni el resultado del formulario', () => {
      const { emit } = mockServer();
      const ticket = {
        id: 'ticket-1',
        branchId: 'branch-a',
        form: {
          type: 'ACCESS_REQUEST',
          data: { email: 'ana@dyra.com' },
          result: { userId: 'u-1' },
          appliedAt: null,
        },
      } as any;

      gateway.emitTicketUpdated(ticket);

      const sent = emit.mock.calls[0][1];
      expect(sent.form).toEqual({
        type: 'ACCESS_REQUEST',
        appliedAt: null,
        hasDetails: true,
      });
      expect(toSocketTicket({ ...ticket, form: null })).toEqual({
        ...ticket,
        form: null,
      });
    });

    it('ticket_overdue va a TI de la sucursal sin exponer branchId en el payload', () => {
      const { to, emit } = mockServer();

      gateway.emitOverdueTicket({
        id: 'ticket-1',
        code: 42,
        title: 'No enciende',
        branchId: 'branch-a',
      });

      expect(to).toHaveBeenCalledWith(['ti:branch-a', TI_GLOBAL_ROOM]);
      expect(emit).toHaveBeenCalledWith('ticket_overdue', {
        id: 'ticket-1',
        code: 42,
        title: 'No enciende',
      });
    });
  });

  describe('emitNewComment', () => {
    const ticket = { id: 'ticket-1', branchId: 'branch-a' };

    it('emite un comentario público a TI de la sucursal y a las salas personales', () => {
      const { to, emit } = mockServer();

      const comment = { id: 'comment-1', isInternal: false } as any;
      gateway.emitNewComment(ticket, comment, ['reporter-1', 'tech-1']);

      const rooms = to.mock.calls[0][0];
      expect(rooms).toEqual(
        expect.arrayContaining([
          'ti:branch-a',
          TI_GLOBAL_ROOM,
          'user:reporter-1',
          'user:tech-1',
        ]),
      );
      expect(rooms).toHaveLength(4);
      expect(emit).toHaveBeenCalledWith('ticket_comment_added', {
        ticketId: 'ticket-1',
        comment,
      });
    });

    it('una nota interna solo llega a TI de la sucursal', () => {
      const { to } = mockServer();

      const comment = { id: 'comment-1', isInternal: true } as any;
      gateway.emitNewComment(ticket, comment, ['reporter-1', 'tech-1']);

      expect(to).toHaveBeenCalledWith(['ti:branch-a', TI_GLOBAL_ROOM]);
    });

    it('ignora IDs nulos/duplicados', () => {
      const { to } = mockServer();

      const comment = { id: 'comment-1', isInternal: false } as any;
      gateway.emitNewComment(ticket, comment, [
        'reporter-1',
        null,
        undefined,
        'reporter-1',
      ]);

      expect(to).toHaveBeenCalledWith([
        'ti:branch-a',
        TI_GLOBAL_ROOM,
        'user:reporter-1',
      ]);
    });
  });
});
