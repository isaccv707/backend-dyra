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

// Cada socket autenticado se une a su propia sala personal (ver
// handleConnection) — así podemos avisarle directo a un usuario específico
// (el que reportó el ticket, el técnico asignado) sin depender de que esté
// en ti_staff_room, que solo une a quienes tienen tickets:update.
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

  // Autentica el socket contra el mismo JWT que usa la API REST. Un token
  // ausente/inválido/expirado, o un usuario inactivo, desconecta el socket
  // de inmediato — nunca queda conectado sin identidad resuelta.
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

  // join_ti_room queda reservado al personal con permiso tickets:update
  // (mismo permiso que exige PATCH /tickets/:id) — cualquier otro usuario
  // autenticado puede seguir usando la API REST, pero no ve el tráfico en
  // vivo de la sala de TI.
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

  // TI siempre ve el comentario (incluidas las notas internas, porque nadie
  // fuera de TI se une a ti_staff_room). Además, si el comentario NO es
  // interno, también se emite a las salas personales de quien reportó el
  // ticket y de quien lo tiene asignado — así un comentario de un usuario
  // normal se renderiza en vivo para TI, y un comentario de TI se renderiza
  // en vivo para el usuario normal, simétricamente. Se arma un solo set de
  // salas y se emite una vez para que un socket presente en varias (p. ej.
  // un técnico de TI que además es el asignado) no reciba el evento
  // duplicado.
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

  // Avisa directo al creador y/o al técnico asignado de un ticket (a
  // diferencia de emitNewTicket/emitTicketUpdated/emitNewComment, que solo
  // llegan a ti_staff_room). Los IDs duplicados o vacíos no generan
  // problema: socket.io emite una sola vez por socket aunque esté en varias
  // de las salas indicadas.
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
