import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { TicketsGateway } from './tickets.gateway';

describe('TicketsGateway', () => {
  let gateway: TicketsGateway;
  let jwtService: { verify: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  const createMockSocket = (overrides: Record<string, unknown> = {}) => ({
    data: {},
    handshake: { auth: {}, headers: {} },
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get(TicketsGateway);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleConnection', () => {
    const activeUser = {
      id: 'user-1',
      isActive: true,
      role: {
        permissions: [{ action: 'tickets:update' }, { action: 'tickets:read' }],
      },
    };

    it('autentica el socket con el token de handshake.auth y guarda userId/permissions', async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@dyra.com' });
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await gateway.handleConnection(client as any);

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(client.data).toEqual({
        userId: 'user-1',
        permissions: ['tickets:update', 'tickets:read'],
      });
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
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await gateway.handleConnection(client as any);

      expect(jwtService.verify).toHaveBeenCalledWith('header-token');
      expect(client.disconnect).not.toHaveBeenCalled();
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

    it('desconecta el socket si el usuario no existe', async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({ sub: 'ghost', email: 'a@dyra.com' });
      prisma.user.findUnique.mockResolvedValue(null);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('desconecta el socket si el usuario está inactivo', async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 'valid-token' }, headers: {} },
      });
      jwtService.verify.mockReturnValue({ sub: 'user-1', email: 'a@dyra.com' });
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isActive: false,
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleJoinTiRoom', () => {
    it('une al socket a la sala de TI cuando tiene el permiso tickets:update', () => {
      const client = createMockSocket({
        data: { userId: 'user-1', permissions: ['tickets:update'] },
      });

      gateway.handleJoinTiRoom(client as any);

      expect(client.join).toHaveBeenCalledWith('ti_staff_room');
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('rechaza con un evento error cuando el socket no tiene el permiso', () => {
      const client = createMockSocket({
        data: { userId: 'user-1', permissions: ['tickets:read'] },
      });

      gateway.handleJoinTiRoom(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No tienes permisos para unirte a la sala de TI',
      });
    });

    it('rechaza cuando el socket no tiene permissions en absoluto', () => {
      const client = createMockSocket({ data: { userId: 'user-1' } });

      gateway.handleJoinTiRoom(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });

  describe('emitNewTicket / emitTicketUpdated', () => {
    it('emite ticket_created a la sala de TI', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as any;

      const ticket = { id: 'ticket-1' } as any;
      gateway.emitNewTicket(ticket);

      expect(to).toHaveBeenCalledWith('ti_staff_room');
      expect(emit).toHaveBeenCalledWith('ticket_created', ticket);
    });

    it('emite ticket_updated a la sala de TI', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as any;

      const ticket = { id: 'ticket-1', status: 'RESOLVED' } as any;
      gateway.emitTicketUpdated(ticket);

      expect(to).toHaveBeenCalledWith('ti_staff_room');
      expect(emit).toHaveBeenCalledWith('ticket_updated', ticket);
    });
  });
});
