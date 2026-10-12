import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { parseCorsOrigins } from 'src/common/utils/cors.util';
import {
  TicketCommentWithAuthor,
  TicketWithRelations,
} from './tickets.service';

const TI_STAFF_ROOM = 'ti_staff_room';
const TI_STAFF_PERMISSION = 'tickets:update';

const userRoom = (userId: string) => `user:${userId}`;

interface TicketsSocketData {
  userId: string;
  permissions: string[];
}

type TicketsSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  TicketsSocketData
>;

@WebSocketGateway({
  namespace: '/tickets',
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
  },
})
export class TicketsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TicketsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: TicketsSocket) {
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
      void client.join(userRoom(user.id));
    } catch (error) {
      this.logger.warn(
        `Rejected /tickets socket connection: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join_ti_room')
  handleJoinTiRoom(@ConnectedSocket() client: TicketsSocket) {
    const permissions: string[] = client.data.permissions ?? [];

    if (!permissions.includes(TI_STAFF_PERMISSION)) {
      client.emit('error', {
        message: 'No tienes permisos para unirte a la sala de TI',
      });
      return;
    }

    void client.join(TI_STAFF_ROOM);
  }

  emitNewTicket(ticket: TicketWithRelations) {
    this.server.to(TI_STAFF_ROOM).emit('ticket_created', ticket);
  }

  emitTicketUpdated(ticket: TicketWithRelations) {
    this.server.to(TI_STAFF_ROOM).emit('ticket_updated', ticket);
  }

  emitNewComment(
    ticketId: string,
    comment: TicketCommentWithAuthor,
    recipientUserIds: (string | null | undefined)[] = [],
  ) {
    const rooms = new Set<string>([TI_STAFF_ROOM]);

    if (!comment.isInternal) {
      for (const userId of recipientUserIds) {
        if (userId) rooms.add(userRoom(userId));
      }
    }

    this.server.to([...rooms]).emit('ticket_comment_added', {
      ticketId,
      comment,
    });
  }

  notifyUsers(
    userIds: (string | null | undefined)[],
    ticketId: string,
    message: string,
  ) {
    const rooms = [...new Set(userIds.filter((id): id is string => !!id))].map(
      userRoom,
    );
    if (rooms.length === 0) return;

    this.server.to(rooms).emit('ticket_notification', { ticketId, message });
  }

  emitOverdueTicket(ticket: { id: string; code: number; title: string }) {
    this.server.to(TI_STAFF_ROOM).emit('ticket_overdue', ticket);
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    const headerToken = client.handshake.headers.authorization?.replace(
      /^Bearer\s+/i,
      '',
    );
    const token = authToken ?? headerToken;

    if (!token) {
      throw new Error('Missing token');
    }

    return token;
  }
}
