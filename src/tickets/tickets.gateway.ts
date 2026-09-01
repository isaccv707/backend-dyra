import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { TicketWithRelations } from './tickets.service';

const TI_STAFF_ROOM = 'ti_staff_room';
const TI_STAFF_PERMISSION = 'tickets:update';

@WebSocketGateway({
  namespace: '/tickets',
  cors: { origin: (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()) },
})
export class TicketsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TicketsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // Autentica el socket contra el mismo JWT que usa la API REST. Un token
  // ausente/inválido/expirado, o un usuario inactivo, desconecta el socket
  // de inmediato — nunca queda conectado sin identidad resuelta.
  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const payload = this.jwtService.verify<JwtPayload>(token);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          isActive: true,
          role: { select: { permissions: { select: { action: true } } } },
        },
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      client.data.userId = user.id;
      client.data.permissions = user.role.permissions.map((p) => p.action);
    } catch (error) {
      this.logger.warn(`Rejected /tickets socket connection: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  // join_ti_room queda reservado al personal con permiso tickets:update
  // (mismo permiso que exige PATCH /tickets/:id) — cualquier otro usuario
  // autenticado puede seguir usando la API REST, pero no ve el tráfico en
  // vivo de la sala de TI.
  @SubscribeMessage('join_ti_room')
  handleJoinTiRoom(@ConnectedSocket() client: Socket) {
    const permissions: string[] = client.data.permissions ?? [];

    if (!permissions.includes(TI_STAFF_PERMISSION)) {
      client.emit('error', { message: 'No tienes permisos para unirte a la sala de TI' });
      return;
    }

    client.join(TI_STAFF_ROOM);
  }

  emitNewTicket(ticket: TicketWithRelations) {
    this.server.to(TI_STAFF_ROOM).emit('ticket_created', ticket);
  }

  emitTicketUpdated(ticket: TicketWithRelations) {
    this.server.to(TI_STAFF_ROOM).emit('ticket_updated', ticket);
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    const headerToken = client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = authToken ?? headerToken;

    if (!token) {
      throw new Error('Missing token');
    }

    return token;
  }
}
