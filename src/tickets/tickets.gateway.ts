import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Interval } from '@nestjs/schedule';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Namespace, RemoteSocket, Socket } from 'socket.io';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { parseCorsOrigins } from 'src/common/utils/cors.util';
import {
  TicketCommentWithAuthor,
  TicketWithRelations,
} from './tickets.service';

const TI_STAFF_PERMISSION = 'tickets:update';
/** TI without branches (global users) sees every branch, like userBranchFilter. */
export const TI_GLOBAL_ROOM = 'ti:global';
const TI_ROOM_PREFIX = 'ti:';
/** How often connected sockets are checked against the user's current state. */
export const SOCKET_REVALIDATE_MS = 5 * 60 * 1000;

const userRoom = (userId: string) => `user:${userId}`;
export const tiBranchRoom = (branchId: string) =>
  `${TI_ROOM_PREFIX}${branchId}`;
/** Rooms of the TI staff that may see a ticket of `branchId`. */
const tiRoomsFor = (branchId: string) => [
  tiBranchRoom(branchId),
  TI_GLOBAL_ROOM,
];

/**
 * Ticket as broadcast to TI: the form goes without its data and result
 * (emails, prices, a whole panel), which the detail loads over REST.
 */
export const toSocketTicket = (ticket: TicketWithRelations) => {
  if (!ticket.form) return ticket;
  const { data: _data, result: _result, ...form } = ticket.form;
  return { ...ticket, form: { ...form, hasDetails: true as const } };
};

interface TicketsSocketData {
  userId: string;
  /** Whether the client asked to receive TI events (join_ti_room). */
  wantsTiRoom?: boolean;
  expiryTimer?: NodeJS.Timeout;
}

type TicketsSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  TicketsSocketData
>;
type AnyTicketsSocket =
  TicketsSocket | RemoteSocket<DefaultEventsMap, TicketsSocketData>;

const USER_ACCESS_SELECT = {
  id: true,
  isActive: true,
  role: { select: { permissions: { select: { action: true } } } },
  branches: { select: { id: true } },
} as const;

interface UserAccess {
  isActive: boolean;
  role: { permissions: { action: string }[] };
  branches: { id: string }[];
}

@WebSocketGateway({
  namespace: '/tickets',
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
  },
})
export class TicketsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TicketsGateway.name);

  @WebSocketServer()
  server: Namespace<
    DefaultEventsMap,
    DefaultEventsMap,
    DefaultEventsMap,
    TicketsSocketData
  >;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Authentication of each socket still in progress. A client emits
   * join_ti_room right after "connect", before handleConnection has finished.
   */
  private readonly authentications = new Map<string, Promise<string | null>>();

  async handleConnection(client: TicketsSocket) {
    const authentication = this.authenticate(client);
    this.authentications.set(client.id, authentication);
    await authentication;
  }

  /** Resolves to the user id, or null after disconnecting the socket. */
  private async authenticate(client: TicketsSocket): Promise<string | null> {
    try {
      const token = this.extractToken(client);
      const payload = this.jwtService.verify<JwtPayload & { exp?: number }>(
        token,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: USER_ACCESS_SELECT,
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      client.data.userId = user.id;
      void client.join(userRoom(user.id));

      // The token was valid when connecting; the socket must not outlive it.
      if (payload.exp) {
        const msLeft = payload.exp * 1000 - Date.now();
        client.data.expiryTimer = setTimeout(
          () => client.disconnect(true),
          Math.max(msLeft, 0),
        );
      }
      return user.id;
    } catch (error) {
      this.logger.warn(
        `Rejected /tickets socket connection: ${(error as Error).message}`,
      );
      client.disconnect(true);
      return null;
    }
  }

  handleDisconnect(client: TicketsSocket) {
    this.authentications.delete(client.id);
    if (client.data.expiryTimer) clearTimeout(client.data.expiryTimer);
  }

  /**
   * Joins the TI rooms of the user's branches. Permissions and branches are
   * read again here (not trusted from the connection).
   */
  @SubscribeMessage('join_ti_room')
  async handleJoinTiRoom(@ConnectedSocket() client: TicketsSocket) {
    const userId =
      (await this.authentications.get(client.id)) ?? client.data.userId;
    if (!userId) return; // rejected: authenticate() already disconnected it

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_ACCESS_SELECT,
    });

    if (!user?.isActive) {
      client.disconnect(true);
      return;
    }

    client.data.wantsTiRoom = true;
    if (!this.syncTiRooms(client, user)) {
      client.emit('error', {
        message: 'No tienes permisos para unirte a la sala de TI',
      });
    }
  }

  /**
   * Revoked permissions, branch changes or a deactivated account apply to open
   * sockets without waiting for a reconnect.
   */
  @Interval(SOCKET_REVALIDATE_MS)
  async revalidateSockets() {
    const sockets = await this.server.fetchSockets();
    const userIds = [
      ...new Set(sockets.map((s) => s.data.userId).filter(Boolean)),
    ];
    if (userIds.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: USER_ACCESS_SELECT,
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    for (const socket of sockets) {
      const user = byId.get(socket.data.userId);
      if (!user?.isActive) {
        socket.disconnect(true);
      } else if (socket.data.wantsTiRoom) {
        this.syncTiRooms(socket, user);
      }
    }
  }

  /** Leaves stale TI rooms and joins the current ones; false = no TI permission. */
  private syncTiRooms(socket: AnyTicketsSocket, user: UserAccess): boolean {
    const canManage = user.role.permissions.some(
      (p) => p.action === TI_STAFF_PERMISSION,
    );
    const target = new Set(
      !canManage
        ? []
        : user.branches.length === 0
          ? [TI_GLOBAL_ROOM]
          : user.branches.map((b) => tiBranchRoom(b.id)),
    );

    for (const room of socket.rooms) {
      if (room.startsWith(TI_ROOM_PREFIX) && !target.has(room)) {
        void socket.leave(room);
      }
    }
    for (const room of target) {
      if (!socket.rooms.has(room)) void socket.join(room);
    }
    return canManage;
  }

  emitNewTicket(ticket: TicketWithRelations) {
    this.server
      .to(tiRoomsFor(ticket.branchId))
      .emit('ticket_created', toSocketTicket(ticket));
  }

  emitTicketUpdated(ticket: TicketWithRelations) {
    this.server
      .to(tiRoomsFor(ticket.branchId))
      .emit('ticket_updated', toSocketTicket(ticket));
  }

  emitNewComment(
    ticket: { id: string; branchId: string },
    comment: TicketCommentWithAuthor,
    recipientUserIds: (string | null | undefined)[] = [],
  ) {
    const rooms = new Set<string>(tiRoomsFor(ticket.branchId));

    if (!comment.isInternal) {
      for (const userId of recipientUserIds) {
        if (userId) rooms.add(userRoom(userId));
      }
    }

    this.server.to([...rooms]).emit('ticket_comment_added', {
      ticketId: ticket.id,
      comment,
    });
  }

  notifyUsers(
    userIds: (string | null | undefined)[],
    notification: {
      ticketId: string;
      ticketCode: number;
      ticketTitle: string;
      kind: string;
      message: string;
    },
  ) {
    const rooms = [...new Set(userIds.filter((id): id is string => !!id))].map(
      userRoom,
    );
    if (rooms.length === 0) return;

    this.server.to(rooms).emit('ticket_notification', notification);
  }

  emitOverdueTicket(ticket: {
    id: string;
    code: number;
    title: string;
    branchId: string;
  }) {
    const { branchId, ...payload } = ticket;
    this.server.to(tiRoomsFor(branchId)).emit('ticket_overdue', payload);
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
